import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import babel from '@rolldown/plugin-babel'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type HistoricalBar = {
  date: string
  close: number
}

type MonthlyReturnPoint = {
  month: string
  returnPct: number
}

type PlaidItemRecord = {
  itemId: string
  accessToken: string
  cursor?: string
  institutionId?: string
  linkedAt: string
}

type PlaidSyncedTransaction = {
  transactionId: string
  itemId: string
  accountId: string
  accountName?: string
  amount: number
  date: string
  name: string
  merchantName?: string
  pending: boolean
}

type PlaidDevStore = {
  items: PlaidItemRecord[]
  transactions: PlaidSyncedTransaction[]
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function loadPlaidDevStore(filePath: string): PlaidDevStore {
  if (!existsSync(filePath)) {
    return { items: [], transactions: [] }
  }
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PlaidDevStore>
    const items = Array.isArray(parsed.items) ? parsed.items : []
    const transactions = Array.isArray(parsed.transactions) ? parsed.transactions : []
    return {
      items: items.filter(
        (item): item is PlaidItemRecord =>
          item &&
          typeof item.itemId === 'string' &&
          typeof item.accessToken === 'string' &&
          typeof item.linkedAt === 'string',
      ),
      transactions: transactions.filter(
        (tx): tx is PlaidSyncedTransaction =>
          tx &&
          typeof tx.transactionId === 'string' &&
          typeof tx.itemId === 'string' &&
          typeof tx.accountId === 'string' &&
          typeof tx.amount === 'number' &&
          typeof tx.date === 'string' &&
          typeof tx.name === 'string' &&
          typeof tx.pending === 'boolean',
      ),
    }
  } catch {
    return { items: [], transactions: [] }
  }
}

function savePlaidDevStore(
  filePath: string,
  items: PlaidItemRecord[],
  transactionsById: Map<string, PlaidSyncedTransaction>,
) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const payload: PlaidDevStore = {
    items,
    transactions: Array.from(transactionsById.values()),
  }
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') return {}
  return parsed as Record<string, unknown>
}

function changeFromDaysAgo(bars: HistoricalBar[], calendarDays: number): number | undefined {
  if (bars.length === 0) return undefined
  const latest = bars[bars.length - 1]
  const latestDate = new Date(`${latest.date}T00:00:00Z`)
  const cutoff = new Date(latestDate)
  cutoff.setUTCDate(cutoff.getUTCDate() - calendarDays)
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  let baseline: HistoricalBar | undefined
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index].date <= cutoffIso) {
      baseline = bars[index]
      break
    }
  }

  if (!baseline || baseline.close <= 0) return undefined
  return ((latest.close - baseline.close) / baseline.close) * 100
}

function parseYahooBars(
  timestamps: Array<number | null | undefined>,
  closes: Array<number | null | undefined>,
): HistoricalBar[] {
  const bars: HistoricalBar[] = []
  const length = Math.min(timestamps.length, closes.length)
  for (let index = 0; index < length; index += 1) {
    const ts = timestamps[index]
    const close = closes[index]
    if (!Number.isFinite(ts) || !Number.isFinite(close) || (close as number) <= 0) continue
    const date = new Date((ts as number) * 1000).toISOString().slice(0, 10)
    bars.push({ date, close: close as number })
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date))
}

function monthlyReturnsFromDailyBars(bars: HistoricalBar[]): MonthlyReturnPoint[] {
  if (bars.length < 2) return []

  const monthEndClose = new Map<string, number>()
  bars.forEach((bar) => {
    const month = bar.date.slice(0, 7)
    monthEndClose.set(month, bar.close)
  })

  const months = Array.from(monthEndClose.keys()).sort((a, b) => a.localeCompare(b))
  const points: MonthlyReturnPoint[] = []

  for (let index = 1; index < months.length; index += 1) {
    const prevClose = monthEndClose.get(months[index - 1])
    const currClose = monthEndClose.get(months[index])
    if (!Number.isFinite(prevClose) || !Number.isFinite(currClose) || (prevClose as number) <= 0) continue
    points.push({
      month: months[index],
      returnPct: (((currClose as number) - (prevClose as number)) / (prevClose as number)) * 100,
    })
  }

  return points
}

function isPlaceholderValue(value: string) {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.length === 0 ||
    normalized.includes('your_') ||
    normalized.includes('actual_') ||
    normalized.includes('replace_me')
  )
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    {
      name: 'market-data-api',
      configureServer(server) {
        const plaidDevStorePath = resolve(process.cwd(), '.local', 'plaid-dev-store.json')
        const loadedPlaidStore = loadPlaidDevStore(plaidDevStorePath)
        const plaidItems: PlaidItemRecord[] = loadedPlaidStore.items
        const plaidTransactionsById = new Map<string, PlaidSyncedTransaction>(
          loadedPlaidStore.transactions.map((transaction) => [transaction.transactionId, transaction]),
        )
        const plaidEnv = (env.PLAID_ENV ?? 'sandbox').trim()
        const plaidClientId = (env.PLAID_CLIENT_ID ?? '').trim()
        const plaidSecret = (env.PLAID_SECRET ?? '').trim()
        const plaidBaseUrl =
          plaidEnv === 'production'
            ? 'https://production.plaid.com'
            : plaidEnv === 'development'
              ? 'https://development.plaid.com'
              : 'https://sandbox.plaid.com'
        const plaidConfigured =
          !isPlaceholderValue(plaidClientId) && !isPlaceholderValue(plaidSecret)

        server.middlewares.use('/api/plaid/status', async (_req, res: ServerResponse) => {
          sendJson(res, 200, {
            configured: plaidConfigured,
            env: plaidEnv,
            itemCount: plaidItems.length,
            syncedTransactionCount: plaidTransactionsById.size,
            persistencePath: plaidDevStorePath,
            needsEnv: !plaidConfigured,
          })
        })

        server.middlewares.use(
          '/api/plaid/transactions',
          async (
            req: IncomingMessage,
            res: ServerResponse,
            next: () => void,
          ) => {
            // Let nested routes continue to their dedicated handlers below.
            if ((req.url ?? '').startsWith('/sync') || (req.url ?? '').startsWith('/reset')) {
              next()
              return
            }
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            const latest = Array.from(plaidTransactionsById.values())
              .sort((a, b) => {
                const dateCompare = b.date.localeCompare(a.date)
                if (dateCompare !== 0) return dateCompare
                return b.transactionId.localeCompare(a.transactionId)
              })
              .slice(0, 100)
            sendJson(res, 200, {
              count: plaidTransactionsById.size,
              transactions: latest,
            })
          },
        )

        server.middlewares.use(
          '/api/plaid/link_token/create',
          async (req: IncomingMessage, res: ServerResponse) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            if (!plaidConfigured) {
              sendJson(res, 400, {
                error:
                  'Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in your environment.',
              })
              return
            }

            try {
              const body = await readJsonBody(req)
              const clientUserId =
                typeof body.client_user_id === 'string' && body.client_user_id.trim().length > 0
                  ? body.client_user_id.trim()
                  : `local-user-${Date.now()}`
              const requestPayload = {
                client_id: plaidClientId,
                secret: plaidSecret,
                client_name: 'Budget App',
                country_codes: ['US'],
                language: 'en',
                user: {
                  client_user_id: clientUserId,
                },
                products: ['transactions'],
              }
              const response = await fetch(`${plaidBaseUrl}/link/token/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
              })
              const data = (await response.json()) as Record<string, unknown>
              if (!response.ok) {
                sendJson(res, response.status, {
                  error: 'Failed to create Plaid link token',
                  plaidError: data,
                })
                return
              }
              sendJson(res, 200, {
                link_token: data.link_token,
                expiration: data.expiration,
              })
            } catch (error) {
              sendJson(res, 500, {
                error: 'Unexpected error creating Plaid link token',
                detail: error instanceof Error ? error.message : 'Unknown error',
              })
            }
          },
        )

        server.middlewares.use(
          '/api/plaid/item/public_token/exchange',
          async (req: IncomingMessage, res: ServerResponse) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            if (!plaidConfigured) {
              sendJson(res, 400, {
                error:
                  'Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in your environment.',
              })
              return
            }

            try {
              const body = await readJsonBody(req)
              const publicToken =
                typeof body.public_token === 'string' ? body.public_token.trim() : ''
              if (!publicToken) {
                sendJson(res, 400, { error: 'Missing public_token' })
                return
              }
              const response = await fetch(`${plaidBaseUrl}/item/public_token/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  client_id: plaidClientId,
                  secret: plaidSecret,
                  public_token: publicToken,
                }),
              })
              const data = (await response.json()) as Record<string, unknown>
              if (!response.ok) {
                sendJson(res, response.status, {
                  error: 'Failed to exchange Plaid public token',
                  plaidError: data,
                })
                return
              }

              const itemId = typeof data.item_id === 'string' ? data.item_id : ''
              const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
              if (itemId && accessToken) {
                if (!plaidItems.some((item) => item.itemId === itemId)) {
                  plaidItems.push({
                    itemId,
                    accessToken,
                    linkedAt: new Date().toISOString(),
                  })
                  savePlaidDevStore(plaidDevStorePath, plaidItems, plaidTransactionsById)
                }
              }

              sendJson(res, 200, {
                item_id: itemId,
                linkedAt: new Date().toISOString(),
                itemCount: plaidItems.length,
              })
            } catch (error) {
              sendJson(res, 500, {
                error: 'Unexpected error exchanging Plaid public token',
                detail: error instanceof Error ? error.message : 'Unknown error',
              })
            }
          },
        )

        server.middlewares.use(
          '/api/plaid/transactions/reset',
          async (req: IncomingMessage, res: ServerResponse) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            plaidTransactionsById.clear()
            plaidItems.forEach((item) => {
              item.cursor = undefined
            })
            savePlaidDevStore(plaidDevStorePath, plaidItems, plaidTransactionsById)
            sendJson(res, 200, {
              itemCount: plaidItems.length,
              count: 0,
              resetCursors: true,
            })
          },
        )

        server.middlewares.use(
          '/api/plaid/transactions/sync',
          async (req: IncomingMessage, res: ServerResponse) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            if (!plaidConfigured) {
              sendJson(res, 400, {
                error:
                  'Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in your environment.',
              })
              return
            }
            if (plaidItems.length === 0) {
              sendJson(res, 400, { error: 'No linked Plaid items yet. Connect a bank first.' })
              return
            }

            try {
              let addedCount = 0
              let modifiedCount = 0
              let removedCount = 0

              for (const item of plaidItems) {
                let hasMore = true
                let cursor = item.cursor
                const accountNameById = new Map<string, string>()

                // Pull accounts for friendly account labels in synced preview.
                const accountsResponse = await fetch(`${plaidBaseUrl}/accounts/get`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    client_id: plaidClientId,
                    secret: plaidSecret,
                    access_token: item.accessToken,
                  }),
                })
                if (accountsResponse.ok) {
                  const accountsData = (await accountsResponse.json()) as {
                    accounts?: Array<{ account_id?: string; name?: string }>
                  }
                  const accounts = accountsData.accounts ?? []
                  accounts.forEach((account) => {
                    if (typeof account.account_id === 'string' && typeof account.name === 'string') {
                      accountNameById.set(account.account_id, account.name)
                    }
                  })
                }

                while (hasMore) {
                  const response = await fetch(`${plaidBaseUrl}/transactions/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      client_id: plaidClientId,
                      secret: plaidSecret,
                      access_token: item.accessToken,
                      cursor,
                      count: 100,
                    }),
                  })
                  const data = (await response.json()) as {
                    added?: Array<{
                      transaction_id?: string
                      account_id?: string
                      amount?: number
                      date?: string
                      name?: string
                      merchant_name?: string
                      pending?: boolean
                    }>
                    modified?: Array<{
                      transaction_id?: string
                      account_id?: string
                      amount?: number
                      date?: string
                      name?: string
                      merchant_name?: string
                      pending?: boolean
                    }>
                    removed?: Array<{ transaction_id?: string }>
                    next_cursor?: string
                    has_more?: boolean
                    error_code?: string
                    error_message?: string
                  }
                  if (!response.ok) {
                    sendJson(res, response.status, {
                      error: 'Failed to sync Plaid transactions',
                      plaidError: data,
                    })
                    return
                  }

                  const upsert = (
                    tx: {
                      transaction_id?: string
                      account_id?: string
                      amount?: number
                      date?: string
                      name?: string
                      merchant_name?: string
                      pending?: boolean
                    },
                    changeType: 'added' | 'modified',
                  ) => {
                    if (
                      typeof tx.transaction_id !== 'string' ||
                      typeof tx.account_id !== 'string' ||
                      typeof tx.amount !== 'number' ||
                      typeof tx.date !== 'string' ||
                      typeof tx.name !== 'string'
                    ) {
                      return
                    }
                    plaidTransactionsById.set(tx.transaction_id, {
                      transactionId: tx.transaction_id,
                      itemId: item.itemId,
                      accountId: tx.account_id,
                      accountName: accountNameById.get(tx.account_id),
                      amount: tx.amount,
                      date: tx.date,
                      name: tx.name,
                      merchantName: tx.merchant_name,
                      pending: Boolean(tx.pending),
                    })
                    if (changeType === 'added') addedCount += 1
                    else modifiedCount += 1
                  }

                  ;(data.added ?? []).forEach((tx) => upsert(tx, 'added'))
                  ;(data.modified ?? []).forEach((tx) => upsert(tx, 'modified'))
                  ;(data.removed ?? []).forEach((tx) => {
                    if (typeof tx.transaction_id !== 'string') return
                    if (plaidTransactionsById.delete(tx.transaction_id)) removedCount += 1
                  })

                  cursor = typeof data.next_cursor === 'string' ? data.next_cursor : cursor
                  hasMore = Boolean(data.has_more)
                }

                item.cursor = cursor
              }

              savePlaidDevStore(plaidDevStorePath, plaidItems, plaidTransactionsById)

              const latest = Array.from(plaidTransactionsById.values())
                .sort((a, b) => {
                  const dateCompare = b.date.localeCompare(a.date)
                  if (dateCompare !== 0) return dateCompare
                  return b.transactionId.localeCompare(a.transactionId)
                })
                .slice(0, 100)

              sendJson(res, 200, {
                itemCount: plaidItems.length,
                added: addedCount,
                modified: modifiedCount,
                removed: removedCount,
                count: plaidTransactionsById.size,
                transactions: latest,
              })
            } catch (error) {
              sendJson(res, 500, {
                error: 'Unexpected error while syncing Plaid transactions',
                detail: error instanceof Error ? error.message : 'Unknown error',
              })
            }
          },
        )

        server.middlewares.use(
          '/api/market/quotes',
          async (req: IncomingMessage, res: ServerResponse) => {
            try {
              const requestUrl = new URL(req.url ?? '', 'http://localhost')
              const symbolsParam = requestUrl.searchParams.get('symbols') ?? ''
              const symbols = Array.from(
                new Set(
                  symbolsParam
                    .split(',')
                    .map((symbol) => symbol.trim().toUpperCase())
                    .filter(Boolean),
                ),
              ).slice(0, 25)

              if (symbols.length === 0) {
                sendJson(res, 400, {
                  error: 'Missing symbols query parameter',
                })
                return
              }

              const quotes = await Promise.all(
                symbols.map(async (symbol) => {
                  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
                    symbol,
                  )}?range=5y&interval=1d`

                  try {
                    const response = await fetch(yahooUrl, {
                      headers: { 'User-Agent': 'Mozilla/5.0' },
                    })
                    if (!response.ok) throw new Error(`HTTP ${response.status}`)
                    const data = (await response.json()) as {
                      chart?: {
                        result?: Array<{
                          timestamp?: number[]
                          indicators?: { quote?: Array<{ close?: Array<number | null> }> }
                          meta?: {
                            regularMarketPrice?: number
                            chartPreviousClose?: number
                            regularMarketTime?: number
                          }
                        }>
                        error?: { description?: string }
                      }
                    }
                    const result = data.chart?.result?.[0]
                    const closes = result?.indicators?.quote?.[0]?.close ?? []
                    const timestamps = result?.timestamp ?? []
                    const bars = parseYahooBars(timestamps, closes)
                    const latestBar = bars[bars.length - 1]
                    if (!latestBar) {
                      return { symbol, error: 'No price data available' }
                    }

                    const close = Number.isFinite(result?.meta?.regularMarketPrice)
                      ? (result?.meta?.regularMarketPrice as number)
                      : latestBar.close
                    const previousClose =
                      bars.length >= 2
                        ? bars[bars.length - 2].close
                        : Number.isFinite(result?.meta?.chartPreviousClose)
                          ? (result?.meta?.chartPreviousClose as number)
                          : close
                    const changePct = previousClose > 0 ? ((close - previousClose) / previousClose) * 100 : 0
                    const periodChanges = {
                      '1D': changePct,
                      '1W': changeFromDaysAgo(bars, 7),
                      '1M': changeFromDaysAgo(bars, 30),
                      '3M': changeFromDaysAgo(bars, 90),
                      '6M': changeFromDaysAgo(bars, 182),
                      '1Y': changeFromDaysAgo(bars, 365),
                    }
                    const monthlyReturns = monthlyReturnsFromDailyBars(bars)
                    const asOf = latestBar.date

                    return {
                      symbol,
                      price: close,
                      previousClose,
                      changePct,
                      periodChanges,
                      monthlyReturns,
                      asOf,
                    }
                  } catch {
                    return { symbol, error: 'Failed to fetch quote' }
                  }
                }),
              )

              sendJson(res, 200, {
                fetchedAt: new Date().toISOString(),
                quotes,
              })
            } catch {
              sendJson(res, 500, {
                error: 'Unexpected server error',
              })
            }
          },
        )
      },
    },
    ],
  }
})
