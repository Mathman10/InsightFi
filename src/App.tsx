import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string, metadata: { institution?: { institution_id?: string } }) => void;
        onExit?: (error: { error_code?: string; error_message?: string } | null) => void;
      }) => { open: () => void; destroy?: () => void };
    };
  }
}

type TransactionType = "income" | "expense";
type RolloverMode = "to_unallocated" | "to_category";
type CategoryIconId =
  | "groceries"
  | "gas"
  | "rent"
  | "utilities"
  | "insurance"
  | "transport"
  | "dining"
  | "shopping"
  | "health"
  | "entertainment"
  | "savings"
  | "other";
type CategoryIconChoice = CategoryIconId | "auto";

type Transaction = {
  id: number;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  date: string;
  source?: "manual" | "plaid";
  plaidTransactionId?: string;
};

type Category = {
  id: number;
  name: string;
  budgeted: number;
  monthKey: string;
  baseBudgeted: number;
  rolloverMode: RolloverMode;
  icon: CategoryIconId;
};

type SavingsGoal = {
  id: number;
  name: string;
  targetAmount: number;
};

type SavingsContribution = {
  id: number;
  goalId: number;
  amount: number;
  date: string;
  note: string;
};

type MarketWindow = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y";
type ReturnLookbackWindow = "6M" | "1Y" | "2Y" | "3Y" | "5Y";
type PlannerPlanMode = "contribution" | "confidence";
type PlannerTrackingMode = "market" | "fixed";
type RetirementTargetMode = "swr" | "preserve_principal";
type TaxFilingStatus = "single" | "married_joint";
type TaxAccountType = "traditional_401k" | "roth_401k" | "taxable_mixed";
type CostBasisMode = "auto" | "manual";
type PlannerTemplateId =
  | "retirement_roth_401k"
  | "retirement_traditional_401k"
  | "education_529"
  | "emergency_fund_hysa";
type InsightAccountType = "asset" | "liability";

type InsightAccount = {
  id: number;
  name: string;
  type: InsightAccountType;
  balance: number;
};

type MortgageForm = {
  homePrice: string;
  downPayment: string;
  interestRate: string;
  termYears: string;
  propertyTaxAnnual: string;
  insuranceAnnual: string;
  hoaMonthly: string;
  pmiMonthly: string;
};
type RentVsBuyForm = {
  homePrice: string;
  downPayment: string;
  interestRate: string;
  termYears: string;
  propertyTaxAnnual: string;
  insuranceAnnual: string;
  hoaMonthly: string;
  pmiMonthly: string;
  maintenanceRatePct: string;
  closingCostPct: string;
  sellCostPct: string;
  appreciationPct: string;
  rentMonthly: string;
  rentIncreasePct: string;
  investReturnPct: string;
  horizonYears: string;
};
type PaydownVsInvestForm = {
  mortgageBalance: string;
  mortgageRatePct: string;
  yearsRemaining: string;
  extraMonthly: string;
  investReturnPct: string;
};

type PlaidStatus = {
  configured: boolean;
  env: string;
  daysRequested?: number;
  itemCount: number;
  syncedTransactionCount?: number;
  needsEnv: boolean;
};

type PlaidSyncedTransactionPreview = {
  transactionId: string;
  itemId: string;
  accountId: string;
  accountName?: string;
  amount: number;
  date: string;
  name: string;
  merchantName?: string;
  pending: boolean;
};

const MARKET_WINDOWS: MarketWindow[] = ["1D", "1W", "1M", "3M", "6M", "1Y"];
const MARKET_WINDOW_LABEL: Record<MarketWindow, string> = {
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  "1Y": "1Y",
};
const MARKET_WINDOW_SUFFIX: Record<MarketWindow, string> = {
  "1D": "today",
  "1W": "this week",
  "1M": "this month",
  "3M": "past 3 months",
  "6M": "past 6 months",
  "1Y": "past year",
};
const RETURN_LOOKBACK_WINDOWS: ReturnLookbackWindow[] = ["6M", "1Y", "2Y", "3Y", "5Y"];
const RETURN_LOOKBACK_MONTHS: Record<ReturnLookbackWindow, number> = {
  "6M": 6,
  "1Y": 12,
  "2Y": 24,
  "3Y": 36,
  "5Y": 60,
};
const PLAID_HISTORY_OPTIONS = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "180D", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
];
const PLANNER_TEMPLATES: { id: PlannerTemplateId; label: string }[] = [
  { id: "retirement_roth_401k", label: "Retirement (Roth 401k)" },
  { id: "retirement_traditional_401k", label: "Retirement (Traditional 401k)" },
  { id: "education_529", label: "Education (529)" },
  { id: "emergency_fund_hysa", label: "Emergency Fund (HYSA)" },
];
const CATEGORY_ICON_OPTIONS: { id: CategoryIconId; label: string }[] = [
  { id: "groceries", label: "Groceries" },
  { id: "gas", label: "Gas" },
  { id: "rent", label: "Rent/Home" },
  { id: "utilities", label: "Utilities" },
  { id: "insurance", label: "Insurance" },
  { id: "transport", label: "Transport" },
  { id: "dining", label: "Dining" },
  { id: "shopping", label: "Shopping" },
  { id: "health", label: "Health" },
  { id: "entertainment", label: "Entertainment" },
  { id: "savings", label: "Savings" },
  { id: "other", label: "Other" },
];
const CATEGORY_KEYWORDS_BY_ICON: Record<CategoryIconId, string[]> = {
  groceries: ["grocery", "grocer", "supermarket", "market", "food", "costco", "target"],
  gas: ["gas", "fuel", "shell", "exxon", "chevron", "qt", "7-eleven"],
  rent: ["rent", "mortgage", "housing", "apartment", "property"],
  utilities: ["utility", "electric", "water", "internet", "phone", "wifi", "power"],
  insurance: ["insurance", "insur", "premium"],
  transport: ["transport", "uber", "lyft", "parking", "toll", "metro", "train", "bus"],
  dining: ["restaurant", "dining", "coffee", "cafe", "takeout", "doordash", "ubereats"],
  shopping: ["shopping", "amazon", "retail", "clothes", "apparel", "walmart"],
  health: ["health", "doctor", "medical", "pharmacy", "dentist", "gym"],
  entertainment: ["entertain", "movie", "game", "music", "hobby", "netflix", "spotify"],
  savings: ["saving", "savings", "investment", "brokerage", "retirement"],
  other: [],
};
const RISK_INFO_COPY: Record<
  RiskInfoKey,
  { title: string; definition: string; read: string }
> = {
  beta: {
    title: "Beta",
    definition: "Beta compares how much your portfolio tends to move relative to the benchmark.",
    read: "Around 1.0 means it has moved similarly to the benchmark. Above 1.0 usually means bigger swings, below 1.0 usually means smaller swings.",
  },
  std_dev: {
    title: "Standard Deviation",
    definition: "Standard deviation measures how spread out your returns have been from month to month.",
    read: "Higher values mean returns have been bumpier. Lower values mean returns have been steadier. Annualized standard deviation is the easier top-line risk number to compare.",
  },
  sharpe: {
    title: "Sharpe Ratio",
    definition: "Sharpe ratio measures return earned above the risk-free rate for each unit of total volatility.",
    read: "Higher is generally better because it means you are being paid more return for the risk you are taking. It treats all volatility, up or down, as risk.",
  },
  sortino: {
    title: "Sortino Ratio",
    definition: "Sortino ratio is similar to Sharpe, but it only penalizes downside volatility.",
    read: "Higher is generally better. It is useful when you care more about bad swings than upside swings, so it often feels more intuitive for goal planning.",
  },
  information: {
    title: "Information Ratio",
    definition: "Information ratio compares your portfolio's return above or below the benchmark against how tightly it tracked that benchmark.",
    read: "Higher is generally better. A positive number means the portfolio has added return relative to the benchmark for the amount of benchmark-tracking noise it took. A negative number means it has lagged the benchmark.",
  },
};

type PlannerConfig = {
  targetDate: string;
  allocations: {
    symbol: string;
    percent: string;
    dollars: string;
  }[];
  planMode: PlannerPlanMode;
  monthlyContribution: string;
  targetConfidence: string;
  trackingMode: PlannerTrackingMode;
  fixedApr: string;
  isRetirementAccount: boolean;
  retirementAnnualSpendGoal: string;
  safeWithdrawalRate: string;
  retirementTargetMode: RetirementTargetMode;
  expectedRealReturn: string;
  taxHouseholdIncome: string;
  taxFilingStatus: TaxFilingStatus;
  taxStateCode: string;
  taxAccountType: TaxAccountType;
  taxableWithdrawalGoal: string;
  taxableCostBasisPercent: string;
  costBasisMode: CostBasisMode;
  benchmarkSymbol: string;
  riskFreeRate: string;
};

type AssetAllocation = {
  symbol: string;
  percent: number;
  dollars: number;
};

type MarketQuote = {
  symbol: string;
  price?: number;
  previousClose?: number;
  changePct?: number;
  periodChanges?: Partial<Record<MarketWindow, number>>;
  monthlyReturns?: { month: string; returnPct: number }[];
  asOf?: string;
  error?: string;
};

type PlannerMarketState = {
  status: "idle" | "loading" | "success" | "error";
  fetchedAt?: string;
  quotes: MarketQuote[];
  error?: string;
};

type RiskMetricSnapshot = {
  overlapCount: number;
  benchmarkSymbol: string;
  beta: number | null;
  monthlyStdDevPct: number | null;
  annualizedStdDevPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  informationRatio: number | null;
};

type RiskInfoKey = "beta" | "std_dev" | "sharpe" | "sortino" | "information";

function formatUsd(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function isCategoryIconId(value: unknown): value is CategoryIconId {
  return CATEGORY_ICON_OPTIONS.some((option) => option.id === value);
}

function autoCategoryIconFromName(name: string): CategoryIconId {
  const normalized = name.trim().toLowerCase();
  if (/grocery|food|supermarket/.test(normalized)) return "groceries";
  if (/gas|fuel/.test(normalized)) return "gas";
  if (/rent|mortgage|home|housing/.test(normalized)) return "rent";
  if (/utility|electric|water|internet|phone/.test(normalized)) return "utilities";
  if (/insur/.test(normalized)) return "insurance";
  if (/transport|uber|lyft|bus|train|metro|car/.test(normalized)) return "transport";
  if (/restaurant|dining|coffee|takeout/.test(normalized)) return "dining";
  if (/shop|amazon|clothes|apparel/.test(normalized)) return "shopping";
  if (/health|doctor|medical|pharmacy|gym/.test(normalized)) return "health";
  if (/fun|entertain|movie|game|music|hobby/.test(normalized)) return "entertainment";
  if (/saving|invest|emergency/.test(normalized)) return "savings";
  return "other";
}

function resolveCategoryIcon(choice: CategoryIconChoice, categoryName: string): CategoryIconId {
  return choice === "auto" ? autoCategoryIconFromName(categoryName) : choice;
}

function categoryIconBadgeStyle(icon: CategoryIconId) {
  const tint: Record<CategoryIconId, string> = {
    groceries: "bg-emerald-100 text-emerald-700",
    gas: "bg-amber-100 text-amber-700",
    rent: "bg-blue-100 text-blue-700",
    utilities: "bg-indigo-100 text-indigo-700",
    insurance: "bg-violet-100 text-violet-700",
    transport: "bg-cyan-100 text-cyan-700",
    dining: "bg-rose-100 text-rose-700",
    shopping: "bg-pink-100 text-pink-700",
    health: "bg-teal-100 text-teal-700",
    entertainment: "bg-fuchsia-100 text-fuchsia-700",
    savings: "bg-sky-100 text-sky-700",
    other: "bg-slate-100 text-slate-700",
  };
  return tint[icon];
}

function CategoryIconGlyph({ iconId, className = "h-4 w-4" }: { iconId: CategoryIconId; className?: string }) {
  switch (iconId) {
    case "groceries":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="19" r="1.5" />
          <circle cx="17" cy="19" r="1.5" />
          <path d="M3 4h2l2.5 10.5h10L22 7H7" />
        </svg>
      );
    case "gas":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 4h8v16H6z" />
          <path d="M14 8h3l1 1v6a2 2 0 0 0 4 0v-5l-2-2" />
        </svg>
      );
    case "rent":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 10l9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "utilities":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M13 2L6 14h5l-1 8 8-13h-5l0-7z" />
        </svg>
      );
    case "insurance":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "transport":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="7" width="18" height="9" rx="2" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="17" cy="18" r="1.5" />
        </svg>
      );
    case "dining":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 3v8" />
          <path d="M10 3v8" />
          <path d="M8 3v18" />
          <path d="M16 3c2 0 3 2 3 4v14" />
        </svg>
      );
    case "shopping":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 7h12l-1 13H7L6 7z" />
          <path d="M9 9V6a3 3 0 0 1 6 0v3" />
        </svg>
      );
    case "health":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 21s-7-4.5-9-9c-1.3-3 1-7 5-7 1.8 0 3.1.8 4 2 1-.8 2.3-2 4-2 4 0 6.3 4 5 7-2 4.5-9 9-9 9z" />
        </svg>
      );
    case "entertainment":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M10 9l5 3-5 3V9z" />
        </svg>
      );
    case "savings":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <ellipse cx="12" cy="12" rx="8" ry="6" />
          <path d="M8 11h8" />
          <path d="M12 9v6" />
        </svg>
      );
    case "other":
    default:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      );
  }
}

function CircularProgress({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(percent, 100));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} strokeWidth="10" className="fill-none stroke-gray-200" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="fill-none stroke-sky-400 transition-all"
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-lg font-bold text-gray-800">{Math.round(clamped)}%</p>
      </div>
    </div>
  );
}

function AllocationPieChart({ allocations }: { allocations: AssetAllocation[] }) {
  const totalPercent = allocations.reduce((sum, allocation) => sum + allocation.percent, 0);
  if (totalPercent <= 0) return null;
  const totalDollars = allocations.reduce((sum, allocation) => sum + allocation.dollars, 0);

  const palette = [
    "#0EA5E9",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#8B5CF6",
    "#14B8A6",
    "#F97316",
    "#EC4899",
  ];

  const gradientStops = allocations
    .reduce(
      (state, allocation, index) => {
        const sharePercent = (allocation.percent / totalPercent) * 100;
        const startPercent = state.runningPercent;
        const nextPercent = startPercent + sharePercent;

        return {
          runningPercent: nextPercent,
          stops: [
            ...state.stops,
            `${palette[index % palette.length]} ${startPercent}% ${nextPercent}%`,
          ],
        };
      },
      { runningPercent: 0, stops: [] as string[] },
    )
    .stops.join(", ");

  return (
    <div className="grid gap-3 md:grid-cols-[170px_1fr] md:items-center">
      <div className="mx-auto">
        <div
          className="relative h-36 w-36 rounded-full border border-gray-200"
          style={{ background: `conic-gradient(${gradientStops})` }}
        >
          <div className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-center">
            <div>
              <p className="text-[10px] font-semibold text-gray-600">Total</p>
              <p className="text-[11px] font-semibold text-gray-700">{formatUsd(totalDollars)}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {allocations.map((allocation, index) => (
          <div key={`${allocation.symbol}-${index}`} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: palette[index % palette.length] }}
              />
              <span className="font-medium text-gray-700">{allocation.symbol}</span>
            </div>
            <span className="text-gray-500">
              {allocation.percent.toFixed(1)}% - {formatUsd(allocation.dollars)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrowthComparisonChart({
  baseTrajectory,
  medianTrajectory,
  lowerTrajectory,
  upperTrajectory,
  startMonthKey,
}: {
  baseTrajectory: number[];
  medianTrajectory: number[];
  lowerTrajectory?: number[];
  upperTrajectory?: number[];
  startMonthKey: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredX, setHoveredX] = useState<number | null>(null);

  useEffect(() => {
    if (!isExpanded) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setIsExpanded(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isExpanded]);

  if (baseTrajectory.length < 2 || medianTrajectory.length < 2) return null;

  const length = Math.min(
    baseTrajectory.length,
    medianTrajectory.length,
    lowerTrajectory?.length ?? Number.MAX_SAFE_INTEGER,
    upperTrajectory?.length ?? Number.MAX_SAFE_INTEGER,
  );
  if (length < 2) return null;

  const base = baseTrajectory.slice(0, length);
  const median = medianTrajectory.slice(0, length);
  const lower = lowerTrajectory?.slice(0, length);
  const upper = upperTrajectory?.slice(0, length);

  const allValues = [...base, ...median, ...(lower ?? []), ...(upper ?? [])];
  const rawMaxValue = Math.max(...allValues, 1);
  const rawMinValue = Math.min(...allValues, 0);

  const niceStep = (rawStep: number) => {
    if (rawStep <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(rawStep));
    const fraction = rawStep / power;
    if (fraction <= 1) return 1 * power;
    if (fraction <= 2) return 2 * power;
    if (fraction <= 5) return 5 * power;
    return 10 * power;
  };

  const desiredYTicks = 5;
  const yStep = niceStep((rawMaxValue - rawMinValue) / desiredYTicks);
  const yMin = Math.floor(rawMinValue / yStep) * yStep;
  const yMax = Math.ceil(rawMaxValue / yStep) * yStep;
  const span = Math.max(yMax - yMin, 1);

  function renderPlot(width: number, height: number, className: string) {
    const padLeft = 86;
    const padRight = 24;
    const padTop = 10;
    const padBottom = 30;
    const chartWidth = width - padLeft - padRight;
    const chartHeight = height - padTop - padBottom;

    const xFor = (index: number) =>
      padLeft + (index / Math.max(length - 1, 1)) * chartWidth;
    const yFor = (value: number) =>
      padTop + ((yMax - value) / span) * chartHeight;

    const pointsFor = (series: number[]) =>
      series.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");

    const basePoints = pointsFor(base);
    const medianPoints = pointsFor(median);
    const bandPath =
      lower && upper
        ? `M ${upper
            .map((value, index) => `${xFor(index)} ${yFor(value)}`)
            .join(" L ")} L ${lower
            .map((value, index) => `${xFor(index)} ${yFor(value)}`)
            .reverse()
            .join(" L ")} Z`
        : null;

    const yTickCount = Math.max(2, Math.min(10, Math.round((yMax - yMin) / yStep)));
    const yTickValues = Array.from({ length: yTickCount + 1 }, (_, index) =>
      yMin + index * yStep,
    ).reverse();

    const totalMonths = length - 1;
    const xTickInterval =
      totalMonths <= 12 ? 1 : totalMonths <= 24 ? 3 : totalMonths <= 48 ? 6 : 12;
    const xTickIndices = Array.from({ length }, (_, index) => index).filter(
      (index) => index % xTickInterval === 0 || index === totalMonths,
    );

    const resolvedHoverIndex = hoveredIndex === null ? null : Math.max(0, Math.min(totalMonths, hoveredIndex));

    return (
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={className}
          onMouseMove={(event) => {
            const svg = event.currentTarget;
            const ctm = svg.getScreenCTM();
            if (!ctm) return;
            const point = svg.createSVGPoint();
            point.x = event.clientX;
            point.y = event.clientY;
            const localPoint = point.matrixTransform(ctm.inverse());
            const xViewBox = localPoint.x;
            const clamped = Math.max(padLeft, Math.min(padLeft + chartWidth, xViewBox));
            const ratio = (clamped - padLeft) / Math.max(chartWidth, 1);
            const index = Math.round(ratio * totalMonths);
            setHoveredIndex(index);
            setHoveredX(clamped);
          }}
          onMouseLeave={() => {
            setHoveredIndex(null);
            setHoveredX(null);
          }}
        >
          {xTickIndices.map((index) => (
            <line
              key={`x-grid-${index}`}
              x1={xFor(index)}
              x2={xFor(index)}
              y1={padTop}
              y2={height - padBottom}
              stroke="#F3F4F6"
              strokeWidth="1"
            />
          ))}
          {yTickValues.map((tickValue, index) => (
            <g key={`y-tick-${index}`}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={yFor(tickValue)}
                y2={yFor(tickValue)}
                stroke="#E5E7EB"
                strokeWidth="1"
              />
              <text
                x={padLeft - 6}
                y={yFor(tickValue) + 4}
                textAnchor="end"
                className="fill-gray-400 text-[12px]"
              >
                {formatUsd(tickValue)}
              </text>
            </g>
          ))}
          {bandPath ? <path d={bandPath} fill="#E0F2FE" opacity="0.8" /> : null}
          <polyline
            points={basePoints}
            fill="none"
            stroke="#6B7280"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
          <polyline
            points={medianPoints}
            fill="none"
            stroke="#0EA5E9"
            strokeWidth="2.5"
          />
          {resolvedHoverIndex !== null && hoveredX !== null ? (
            <line
              x1={hoveredX}
              x2={hoveredX}
              y1={padTop}
              y2={height - padBottom}
              stroke="#0EA5E9"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
          ) : null}
          {xTickIndices.map((index) => {
            const monthKey = shiftMonth(startMonthKey, index);
            const [year, month] = monthKey.split("-").map(Number);
            const tickDate = new Date(year, month - 1, 1);
            const label = tickDate.toLocaleString("en-US", {
              month: "short",
              year: "2-digit",
            });
            return (
              <text
                key={`x-tick-${index}`}
                x={xFor(index)}
                y={height - 8}
                textAnchor={index === 0 ? "start" : index === totalMonths ? "end" : "middle"}
                className="fill-gray-400 text-[12px]"
              >
                {label}
              </text>
            );
          })}
        </svg>
        {resolvedHoverIndex !== null ? (
          <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-gray-200 bg-white/95 px-3 py-2 text-xs shadow">
            <p className="font-semibold text-gray-800">{formatMonthLabel(shiftMonth(startMonthKey, resolvedHoverIndex))}</p>
            <p className="text-gray-600">Base: <span className="font-medium text-gray-800">{formatUsd(base[resolvedHoverIndex])}</span></p>
            <p className="text-gray-600">Median: <span className="font-medium text-sky-700">{formatUsd(median[resolvedHoverIndex])}</span></p>
            {lower ? <p className="text-gray-600">P25: <span className="font-medium text-gray-800">{formatUsd(lower[resolvedHoverIndex])}</span></p> : null}
            {upper ? <p className="text-gray-600">P75: <span className="font-medium text-gray-800">{formatUsd(upper[resolvedHoverIndex])}</span></p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div
        className="mt-4 cursor-zoom-in rounded-lg border border-gray-200 bg-white p-3"
        onClick={() => setIsExpanded(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsExpanded(true);
          }
        }}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-gray-700">
              <span className="h-2 w-2 rounded-full bg-gray-500" />
              Base (No Returns)
            </span>
            <span className="inline-flex items-center gap-1.5 text-sky-700">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              With Returns (Median)
            </span>
            {lower && upper ? (
              <span className="inline-flex items-center gap-1.5 text-sky-600">
                <span className="h-2 w-2 rounded-full bg-sky-200" />
                P25-P75 Band
              </span>
            ) : null}
          </div>
          <span className="text-gray-400">Click to expand</span>
        </div>
        {renderPlot(680, 240, "h-56 w-full")}
      </div>

      {isExpanded ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setIsExpanded(false)}
        >
          <div
            className="w-full max-w-6xl rounded-xl bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Growth Projection Detail</p>
              <button
                className="rounded-md bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                onClick={() => setIsExpanded(false)}
              >
                Close
              </button>
            </div>
            {renderPlot(1200, 500, "h-[70vh] min-h-[420px] w-full")}
          </div>
        </div>
      ) : null}
    </>
  );
}

function getMonthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function shiftMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  return getMonthKey(new Date(year, month - 1 + delta, 1));
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function compareMonthKeys(a: string, b: string) {
  return a.localeCompare(b);
}

function monthFromDate(date: string) {
  return date.slice(0, 7);
}

function monthEndDate(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const end = new Date(year, month, 0);
  const endYear = end.getFullYear();
  const endMonth = String(end.getMonth() + 1).padStart(2, "0");
  const endDay = String(end.getDate()).padStart(2, "0");
  return `${endYear}-${endMonth}-${endDay}`;
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function sanitizeAllocations(
  allocations: { symbol: string; percent: string; dollars: string }[],
  portfolioValue: number,
): AssetAllocation[] {
  return allocations
    .map((allocation) => {
      const symbol = allocation.symbol.trim().toUpperCase();
      const percent = Number(allocation.percent);
      const dollars = Number(allocation.dollars);
      const hasPercent = Number.isFinite(percent) && percent > 0;
      const hasDollars = Number.isFinite(dollars) && dollars > 0;

      const resolvedPercent =
        hasPercent
          ? percent
          : hasDollars && portfolioValue > 0
            ? (dollars / portfolioValue) * 100
            : 0;
      const resolvedDollars =
        hasDollars
          ? dollars
          : hasPercent
            ? (portfolioValue * percent) / 100
            : 0;

      return {
        symbol,
        percent: resolvedPercent,
        dollars: resolvedDollars,
      };
    })
    .filter(
      (allocation) =>
        allocation.symbol.length > 0 &&
        Number.isFinite(allocation.percent) &&
        Number.isFinite(allocation.dollars) &&
        allocation.percent > 0 &&
        allocation.dollars >= 0,
    );
}

function allocationValidation(
  allocations: { symbol: string; percent: string; dollars: string }[],
) {
  const parsed = allocations
    .map((allocation) => ({
      symbol: allocation.symbol.trim().toUpperCase(),
      percent: Number(allocation.percent),
      dollars: Number(allocation.dollars),
    }))
    .filter((allocation) => allocation.symbol.length > 0);

  const totalPercent = parsed
    .filter((allocation) => Number.isFinite(allocation.percent))
    .reduce((sum, allocation) => sum + allocation.percent, 0);
  const totalDollars = parsed
    .filter((allocation) => Number.isFinite(allocation.dollars))
    .reduce((sum, allocation) => sum + allocation.dollars, 0);
  const hasExactHundred = Math.abs(totalPercent - 100) < 0.01;
  const hasPositiveDollarTotal = totalDollars > 0;

  const symbols = parsed.map((allocation) => allocation.symbol);
  const duplicateSymbols = symbols.filter(
    (symbol, index) => symbols.indexOf(symbol) !== index,
  );
  const uniqueDuplicates = Array.from(new Set(duplicateSymbols));

  const invalidSymbolInputs = allocations
    .map((allocation) => allocation.symbol.trim().toUpperCase())
    .filter((symbol) => symbol.length > 0)
    .filter((symbol) => !/^[A-Z][A-Z0-9.-]*$/.test(symbol));

  return {
    totalPercent,
    totalDollars,
    hasExactHundred,
    hasPositiveDollarTotal,
    duplicateSymbols: uniqueDuplicates,
    invalidSymbolInputs,
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

const MONTE_CARLO_DISPLAY_RUNS = 10000;
const MONTE_CARLO_SOLVER_RUNS = 2000;
const MONTE_CARLO_BLOCK_SIZE = 6;
const MONTE_CARLO_PATH_RUNS = 1200;

function hashForSeed(values: number[]) {
  let hash = 2166136261;
  values.forEach((value, index) => {
    const part = Math.round(value * 1000) + index * 2654435761;
    hash ^= part;
    hash = Math.imul(hash, 16777619);
  });
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function simulateFinalFundValues(
  currentSaved: number,
  monthlyContribution: number,
  monthsToGoal: number,
  monthlyReturns: number[],
  runCount = MONTE_CARLO_DISPLAY_RUNS,
  blockSize = MONTE_CARLO_BLOCK_SIZE,
) {
  const months = Math.max(Math.floor(monthsToGoal), 0);
  if (months === 0) return [Math.max(currentSaved, 0)];
  if (monthlyReturns.length === 0) {
    return [Math.max(currentSaved, 0) + Math.max(monthlyContribution, 0) * months];
  }

  const history = monthlyReturns.map((value) => value / 100);
  const effectiveRuns = Math.max(200, Math.floor(runCount));
  const effectiveBlock = Math.max(1, Math.floor(blockSize));
  const seed = hashForSeed([
    currentSaved,
    monthlyContribution,
    months,
    ...history.slice(0, 120).map((value) => value * 100),
    effectiveRuns,
    effectiveBlock,
  ]);
  const random = mulberry32(seed);
  const output: number[] = [];
  for (let run = 0; run < effectiveRuns; run += 1) {
    let balance = Math.max(currentSaved, 0);
    let monthIndex = 0;
    while (monthIndex < months) {
      const start = Math.floor(random() * history.length);
      for (let offset = 0; offset < effectiveBlock && monthIndex < months; offset += 1) {
        const sampled = history[(start + offset) % history.length];
        balance = balance * (1 + sampled) + monthlyContribution;
        monthIndex += 1;
      }
    }
    output.push(balance);
  }

  return output;
}

function buildNoReturnTrajectory(
  currentSaved: number,
  monthlyContribution: number,
  monthsToGoal: number,
) {
  const months = Math.max(Math.floor(monthsToGoal), 0);
  const values = [Math.max(currentSaved, 0)];
  let balance = Math.max(currentSaved, 0);
  for (let month = 0; month < months; month += 1) {
    balance += monthlyContribution;
    values.push(balance);
  }
  return values;
}

function simulatePercentileTrajectories(
  currentSaved: number,
  monthlyContribution: number,
  monthsToGoal: number,
  monthlyReturns: number[],
  runCount = MONTE_CARLO_PATH_RUNS,
  blockSize = MONTE_CARLO_BLOCK_SIZE,
) {
  const months = Math.max(Math.floor(monthsToGoal), 0);
  if (months === 0) {
    const start = [Math.max(currentSaved, 0)];
    return { p25: start, p50: start, p75: start };
  }
  if (monthlyReturns.length === 0) {
    const base = buildNoReturnTrajectory(currentSaved, monthlyContribution, monthsToGoal);
    return { p25: base, p50: base, p75: base };
  }

  const history = monthlyReturns.map((value) => value / 100);
  const effectiveRuns = Math.max(200, Math.floor(runCount));
  const effectiveBlock = Math.max(1, Math.floor(blockSize));
  const seed = hashForSeed([
    currentSaved,
    monthlyContribution,
    months,
    ...history.slice(0, 120).map((value) => value * 100),
    effectiveRuns,
    effectiveBlock,
    91357,
  ]);
  const random = mulberry32(seed);

  const buckets = Array.from({ length: months + 1 }, () => [] as number[]);
  for (let run = 0; run < effectiveRuns; run += 1) {
    let balance = Math.max(currentSaved, 0);
    buckets[0].push(balance);
    let monthIndex = 0;
    while (monthIndex < months) {
      const start = Math.floor(random() * history.length);
      for (let offset = 0; offset < effectiveBlock && monthIndex < months; offset += 1) {
        const sampled = history[(start + offset) % history.length];
        balance = balance * (1 + sampled) + monthlyContribution;
        monthIndex += 1;
        buckets[monthIndex].push(balance);
      }
    }
  }

  return {
    p25: buckets.map((values) => percentile(values, 0.25)),
    p50: buckets.map((values) => percentile(values, 0.5)),
    p75: buckets.map((values) => percentile(values, 0.75)),
  };
}

function successProbability(finalValues: number[], targetAmount: number) {
  if (finalValues.length === 0) return 0;
  const hits = finalValues.filter((value) => value >= targetAmount).length;
  return hits / finalValues.length;
}

function requiredMonthlyContributionForProbability(
  currentSaved: number,
  monthsToGoal: number,
  targetAmount: number,
  monthlyReturns: number[],
  targetProbability: number,
) {
  if (monthsToGoal <= 0) return Math.max(targetAmount - currentSaved, 0);

  let low = 0;
  let high = Math.max(targetAmount, 1);
  for (let i = 0; i < 12; i += 1) {
    const finalsAtHigh = simulateFinalFundValues(
      currentSaved,
      high,
      monthsToGoal,
      monthlyReturns,
      MONTE_CARLO_SOLVER_RUNS,
    );
    if (successProbability(finalsAtHigh, targetAmount) >= targetProbability) break;
    high *= 2;
  }

  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2;
    const finalsAtMid = simulateFinalFundValues(
      currentSaved,
      mid,
      monthsToGoal,
      monthlyReturns,
      MONTE_CARLO_SOLVER_RUNS,
    );
    const probAtMid = successProbability(finalsAtMid, targetAmount);
    if (probAtMid >= targetProbability) high = mid;
    else low = mid;
  }

  return high;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function covariance(valuesA: number[], valuesB: number[]) {
  if (valuesA.length !== valuesB.length || valuesA.length < 2) return null;
  const meanA = average(valuesA);
  const meanB = average(valuesB);
  const cov =
    valuesA.reduce((sum, value, index) => sum + (value - meanA) * (valuesB[index] - meanB), 0) /
    (valuesA.length - 1);
  return cov;
}

function calculateRiskMetrics(args: {
  portfolioMonthlyReturnsPct: number[];
  benchmarkMonthlyReturnsPct: number[];
  benchmarkSymbol: string;
  riskFreeRatePct: number;
}): RiskMetricSnapshot {
  const {
    portfolioMonthlyReturnsPct,
    benchmarkMonthlyReturnsPct,
    benchmarkSymbol,
    riskFreeRatePct,
  } = args;
  const overlapCount = Math.min(
    portfolioMonthlyReturnsPct.length,
    benchmarkMonthlyReturnsPct.length,
  );
  if (overlapCount < 2) {
    return {
      overlapCount,
      benchmarkSymbol,
      beta: null,
      monthlyStdDevPct: null,
      annualizedStdDevPct: null,
      sharpeRatio: null,
      sortinoRatio: null,
      informationRatio: null,
    };
  }

  const portfolioDecimals = portfolioMonthlyReturnsPct.slice(-overlapCount).map((value) => value / 100);
  const benchmarkDecimals = benchmarkMonthlyReturnsPct.slice(-overlapCount).map((value) => value / 100);
  const monthlyRiskFreeDecimal = riskFreeRatePct / 100 / 12;
  const monthlyStdDev = sampleStandardDeviation(portfolioDecimals);
  const annualizedStdDev = monthlyStdDev !== null ? monthlyStdDev * Math.sqrt(12) : null;
  const benchmarkVariance = sampleStandardDeviation(benchmarkDecimals);
  const beta =
    benchmarkVariance !== null && benchmarkVariance > 0
      ? (() => {
          const cov = covariance(portfolioDecimals, benchmarkDecimals);
          return cov !== null ? cov / benchmarkVariance ** 2 : null;
        })()
      : null;
  const excessReturns = portfolioDecimals.map((value) => value - monthlyRiskFreeDecimal);
  const averageExcessReturn = average(excessReturns);
  const sharpeRatio =
    monthlyStdDev !== null && monthlyStdDev > 0
      ? (averageExcessReturn / monthlyStdDev) * Math.sqrt(12)
      : null;
  const downsideReturns = excessReturns.filter((value) => value < 0);
  const downsideDeviation =
    downsideReturns.length >= 2 ? sampleStandardDeviation(downsideReturns) : null;
  const sortinoRatio =
    downsideDeviation !== null && downsideDeviation > 0
      ? (averageExcessReturn / downsideDeviation) * Math.sqrt(12)
      : null;
  const activeReturns = portfolioDecimals.map((value, index) => value - benchmarkDecimals[index]);
  const trackingError = sampleStandardDeviation(activeReturns);
  const informationRatio =
    trackingError !== null && trackingError > 0
      ? (average(activeReturns) / trackingError) * Math.sqrt(12)
      : null;

  return {
    overlapCount,
    benchmarkSymbol,
    beta,
    monthlyStdDevPct: monthlyStdDev !== null ? monthlyStdDev * 100 : null,
    annualizedStdDevPct: annualizedStdDev !== null ? annualizedStdDev * 100 : null,
    sharpeRatio,
    sortinoRatio,
    informationRatio,
  };
}

function reorderIds<T extends { id: number }>(items: T[], activeId: number, overId: number) {
  const fromIndex = items.findIndex((item) => item.id === activeId);
  const toIndex = items.findIndex((item) => item.id === overId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function reorderSubsetByIds<T extends { id: number }>(
  items: T[],
  predicate: (item: T) => boolean,
  activeId: number,
  overId: number,
) {
  const subset = items.filter(predicate);
  const reorderedSubset = reorderIds(subset, activeId, overId);
  if (subset === reorderedSubset) return items;
  let subsetIndex = 0;
  return items.map((item) =>
    predicate(item) ? reorderedSubset[subsetIndex++] : item,
  );
}

function projectionStatusSummary(args: {
  hasProjectionData: boolean;
  currentSaved: number;
  targetAmount: number;
  hitProbability: number;
  targetConfidenceProbability: number;
  requiredMonthlyForConfidence: number;
}) {
  const {
    hasProjectionData,
    currentSaved,
    targetAmount,
    hitProbability,
    targetConfidenceProbability,
    requiredMonthlyForConfidence,
  } = args;

  if (!hasProjectionData) {
    return {
      label: "No Data Yet",
      message: "Add projection inputs to unlock guidance.",
      toneClass: "bg-gray-100 text-gray-700",
    };
  }

  if (
    currentSaved >= targetAmount ||
    (requiredMonthlyForConfidence <= 0.5 && hitProbability >= targetConfidenceProbability)
  ) {
    return {
      label: "Goal Locked",
      message: "You can stop contributions and still finish on target.",
      toneClass: "bg-emerald-100 text-emerald-700",
    };
  }

  if (requiredMonthlyForConfidence <= 5 && hitProbability >= targetConfidenceProbability) {
    return {
      label: "Coasting",
      message: "Compounding is doing most of the work now.",
      toneClass: "bg-sky-100 text-sky-700",
    };
  }

  if (hitProbability >= targetConfidenceProbability - 0.1) {
    return {
      label: "On Track",
      message: "Your current plan is close to target confidence.",
      toneClass: "bg-amber-100 text-amber-700",
    };
  }

  return {
    label: "Stretch Zone",
    message: "Increase contribution, extend timeline, or lower confidence target.",
    toneClass: "bg-rose-100 text-rose-700",
  };
}

function federalOrdinaryMarginalRate(income: number, filingStatus: TaxFilingStatus) {
  const brackets =
    filingStatus === "married_joint"
      ? [
          { max: 23200, rate: 10 },
          { max: 94300, rate: 12 },
          { max: 201050, rate: 22 },
          { max: 383900, rate: 24 },
          { max: 487450, rate: 32 },
          { max: 731200, rate: 35 },
          { max: Number.POSITIVE_INFINITY, rate: 37 },
        ]
      : [
          { max: 11600, rate: 10 },
          { max: 47150, rate: 12 },
          { max: 100525, rate: 22 },
          { max: 191950, rate: 24 },
          { max: 243725, rate: 32 },
          { max: 609350, rate: 35 },
          { max: Number.POSITIVE_INFINITY, rate: 37 },
        ];
  for (const bracket of brackets) {
    if (income <= bracket.max) return bracket.rate;
  }
  return 37;
}

function federalCapitalGainsRate(income: number, filingStatus: TaxFilingStatus) {
  if (filingStatus === "married_joint") {
    if (income <= 94050) return 0;
    if (income <= 583750) return 15;
    return 20;
  }
  if (income <= 47025) return 0;
  if (income <= 518900) return 15;
  return 20;
}

function estimatedStateIncomeTaxRate(stateCode: string) {
  const code = stateCode.trim().toUpperCase();
  if (["TX", "FL", "WA", "NV", "TN", "WY", "AK", "SD", "NH"].includes(code)) return 0;
  if (["CA", "NY", "NJ", "OR", "MN", "HI"].includes(code)) return 8;
  if (["IL", "PA", "CO", "AZ", "NC", "MA", "MI", "UT"].includes(code)) return 5;
  return 4;
}

function accountTaxMix(accountType: TaxAccountType) {
  if (accountType === "traditional_401k") {
    return { ordinaryShare: 100, capGainsShare: 0 };
  }
  if (accountType === "roth_401k") {
    return { ordinaryShare: 0, capGainsShare: 0 };
  }
  return { ordinaryShare: 30, capGainsShare: 70 };
}

function allocationRowsFromWeights(
  currentSaved: number,
  weights: Array<{ symbol: string; percent: number }>,
) {
  return weights.map((weight) => ({
    symbol: weight.symbol,
    percent: weight.percent.toString(),
    dollars: ((Math.max(currentSaved, 0) * weight.percent) / 100).toFixed(2),
  }));
}

function applyPlannerTemplate(
  currentConfig: PlannerConfig,
  templateId: PlannerTemplateId,
  currentSaved: number,
) {
  const base = { ...currentConfig };

  if (templateId === "retirement_roth_401k") {
    return {
      ...base,
      trackingMode: "market" as PlannerTrackingMode,
      isRetirementAccount: true,
      planMode: "contribution" as PlannerPlanMode,
      monthlyContribution: "500",
      targetConfidence: "70",
      allocations: allocationRowsFromWeights(currentSaved, [
        { symbol: "SPY", percent: 75 },
        { symbol: "VEA", percent: 25 },
      ]),
      taxAccountType: "roth_401k" as TaxAccountType,
      taxFilingStatus: "married_joint" as TaxFilingStatus,
      taxHouseholdIncome: "140000",
      taxStateCode: "TX",
      retirementAnnualSpendGoal: "70000",
      safeWithdrawalRate: "4.0",
      retirementTargetMode: "swr" as RetirementTargetMode,
      expectedRealReturn: "3.0",
    };
  }

  if (templateId === "retirement_traditional_401k") {
    return {
      ...base,
      trackingMode: "market" as PlannerTrackingMode,
      isRetirementAccount: true,
      planMode: "contribution" as PlannerPlanMode,
      monthlyContribution: "500",
      targetConfidence: "70",
      allocations: allocationRowsFromWeights(currentSaved, [
        { symbol: "SPY", percent: 75 },
        { symbol: "VEA", percent: 25 },
      ]),
      taxAccountType: "traditional_401k" as TaxAccountType,
      taxFilingStatus: "married_joint" as TaxFilingStatus,
      taxHouseholdIncome: "140000",
      taxStateCode: "TX",
      retirementAnnualSpendGoal: "70000",
      safeWithdrawalRate: "4.0",
      retirementTargetMode: "swr" as RetirementTargetMode,
      expectedRealReturn: "3.0",
    };
  }

  if (templateId === "education_529") {
    return {
      ...base,
      trackingMode: "market" as PlannerTrackingMode,
      isRetirementAccount: false,
      planMode: "contribution" as PlannerPlanMode,
      monthlyContribution: "300",
      targetConfidence: "70",
      allocations: allocationRowsFromWeights(currentSaved, [
        { symbol: "SPY", percent: 70 },
        { symbol: "VEA", percent: 30 },
      ]),
      benchmarkSymbol: "SPY",
      riskFreeRate: "2.0",
    };
  }

  return {
    ...base,
    trackingMode: "fixed" as PlannerTrackingMode,
    isRetirementAccount: false,
    planMode: "contribution" as PlannerPlanMode,
    monthlyContribution: "200",
    targetConfidence: "80",
    fixedApr: "4.25",
    allocations: allocationRowsFromWeights(currentSaved, [{ symbol: "SPY", percent: 100 }]),
    benchmarkSymbol: "SPY",
    riskFreeRate: "2.0",
  };
}

function normalizeCategory(category: Partial<Category>): Category {
  const safeBudgeted =
    typeof category.budgeted === "number" && Number.isFinite(category.budgeted)
      ? category.budgeted
      : typeof category.baseBudgeted === "number" && Number.isFinite(category.baseBudgeted)
        ? category.baseBudgeted
        : 0;

  return {
    id: typeof category.id === "number" ? category.id : Date.now(),
    name: typeof category.name === "string" ? category.name : "Unnamed Category",
    budgeted: safeBudgeted,
    baseBudgeted:
      typeof category.baseBudgeted === "number" && Number.isFinite(category.baseBudgeted)
        ? category.baseBudgeted
        : safeBudgeted,
    monthKey: typeof category.monthKey === "string" ? category.monthKey : "2026-04",
    rolloverMode:
      category.rolloverMode === "to_category" ? "to_category" : "to_unallocated",
    icon: isCategoryIconId(category.icon)
      ? category.icon
      : autoCategoryIconFromName(typeof category.name === "string" ? category.name : ""),
  };
}

export default function App() {
  const [activeView, setActiveView] = useState<"budget" | "insights" | "goal_planning">("budget");
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem("budget-dark-mode");
    if (!saved) return false;
    return saved === "true";
  });
  const [selectedMonthKey, setSelectedMonthKey] = useState("2026-04");
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showContributionForm, setShowContributionForm] = useState(false);

  const [editingTransactionId, setEditingTransactionId] = useState<number | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<number | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null);
  const [editingContributionId, setEditingContributionId] = useState<number | null>(null);
  const [pendingResetMonth, setPendingResetMonth] = useState<string | null>(null);

  const defaultCategories: Category[] = [
    {
      id: 1,
      name: "Food",
      budgeted: 250,
      baseBudgeted: 250,
      monthKey: "2026-04",
      rolloverMode: "to_unallocated",
      icon: "groceries",
    },
    {
      id: 2,
      name: "Gas",
      budgeted: 120,
      baseBudgeted: 120,
      monthKey: "2026-04",
      rolloverMode: "to_unallocated",
      icon: "gas",
    },
    {
      id: 3,
      name: "Fun",
      budgeted: 100,
      baseBudgeted: 100,
      monthKey: "2026-04",
      rolloverMode: "to_unallocated",
      icon: "entertainment",
    },
  ];

  const defaultProjectedIncomeByMonth: Record<string, number> = {
    "2026-04": 1200,
  };

  const defaultTransactions: Transaction[] = [
    { id: 1, description: "Groceries", amount: 86.42, type: "expense", category: "Food", date: "2026-04-01" },
    { id: 2, description: "Fuel", amount: 47.15, type: "expense", category: "Gas", date: "2026-04-02" },
    { id: 3, description: "Paycheck", amount: 850, type: "income", category: "Income", date: "2026-04-03" },
    { id: 4, description: "March Paycheck", amount: 900, type: "income", category: "Income", date: "2026-03-03" },
    { id: 5, description: "March Groceries", amount: 110, type: "expense", category: "Food", date: "2026-03-08" },
  ];

  const defaultGoals: SavingsGoal[] = [
    { id: 1, name: "Emergency Fund", targetAmount: 10000 },
    { id: 2, name: "Down Payment", targetAmount: 30000 },
  ];

  const defaultContributions: SavingsContribution[] = [
    { id: 1, goalId: 1, amount: 250, date: "2026-04-05", note: "Initial funding" },
    { id: 2, goalId: 2, amount: 150, date: "2026-04-08", note: "Monthly transfer" },
  ];
  const defaultInsightAccounts: InsightAccount[] = [
    { id: 1, name: "Checking", type: "asset", balance: 4200 },
    { id: 2, name: "Credit Card", type: "liability", balance: 850 },
  ];
  const defaultMortgageForm: MortgageForm = {
    homePrice: "450000",
    downPayment: "90000",
    interestRate: "6.25",
    termYears: "30",
    propertyTaxAnnual: "5400",
    insuranceAnnual: "1800",
    hoaMonthly: "0",
    pmiMonthly: "0",
  };
  const defaultRentVsBuyForm: RentVsBuyForm = {
    homePrice: "450000",
    downPayment: "90000",
    interestRate: "6.25",
    termYears: "30",
    propertyTaxAnnual: "5400",
    insuranceAnnual: "1800",
    hoaMonthly: "0",
    pmiMonthly: "0",
    maintenanceRatePct: "1.0",
    closingCostPct: "3.0",
    sellCostPct: "6.0",
    appreciationPct: "3.0",
    rentMonthly: "2500",
    rentIncreasePct: "3.0",
    investReturnPct: "7.0",
    horizonYears: "7",
  };
  const defaultPaydownVsInvestForm: PaydownVsInvestForm = {
    mortgageBalance: "350000",
    mortgageRatePct: "6.25",
    yearsRemaining: "30",
    extraMonthly: "500",
    investReturnPct: "7.0",
  };

  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem("budget-categories");
    if (!saved) return defaultCategories;
    try {
      const parsed = JSON.parse(saved) as Partial<Category>[];
      return parsed.map(normalizeCategory);
    } catch {
      return defaultCategories;
    }
  });

  const [projectedIncomeByMonth, setProjectedIncomeByMonth] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem("budget-projected-income");
    if (!saved) return defaultProjectedIncomeByMonth;
    try {
      const parsed = JSON.parse(saved) as unknown;
      if (Array.isArray(parsed)) {
        const migrated = parsed.reduce<Record<string, number>>((running, item) => {
          if (
            item &&
            typeof item === "object" &&
            "monthKey" in item &&
            "amount" in item &&
            typeof (item as { monthKey?: unknown }).monthKey === "string" &&
            typeof (item as { amount?: unknown }).amount === "number"
          ) {
            const monthKey = (item as { monthKey: string }).monthKey;
            const amount = (item as { amount: number }).amount;
            running[monthKey] = (running[monthKey] ?? 0) + amount;
          }
          return running;
        }, {});
        return Object.keys(migrated).length > 0 ? migrated : defaultProjectedIncomeByMonth;
      }
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, number>>(
          (running, [monthKey, value]) => {
            if (typeof value === "number" && Number.isFinite(value)) running[monthKey] = value;
            return running;
          },
          {},
        );
      }
      return defaultProjectedIncomeByMonth;
    } catch {
      return defaultProjectedIncomeByMonth;
    }
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem("budget-transactions");
    if (!saved) return defaultTransactions;
    try {
      return JSON.parse(saved) as Transaction[];
    } catch {
      return defaultTransactions;
    }
  });

  const [goals, setGoals] = useState<SavingsGoal[]>(() => {
    const saved = localStorage.getItem("budget-savings-goals");
    if (!saved) return defaultGoals;
    try {
      return JSON.parse(saved) as SavingsGoal[];
    } catch {
      return defaultGoals;
    }
  });

  const [contributions, setContributions] = useState<SavingsContribution[]>(() => {
    const saved = localStorage.getItem("budget-savings-contributions");
    if (!saved) return defaultContributions;
    try {
      return JSON.parse(saved) as SavingsContribution[];
    } catch {
      return defaultContributions;
    }
  });
  const [insightAccounts, setInsightAccounts] = useState<InsightAccount[]>(() => {
    const saved = localStorage.getItem("budget-insight-accounts");
    if (!saved) return defaultInsightAccounts;
    try {
      const parsed = JSON.parse(saved) as Partial<InsightAccount>[];
      return parsed
        .map((account) => ({
          id: typeof account.id === "number" ? account.id : Date.now(),
          name: typeof account.name === "string" && account.name.trim().length > 0 ? account.name : "Unnamed",
          type: account.type === "liability" ? "liability" : "asset",
          balance:
            typeof account.balance === "number" && Number.isFinite(account.balance) ? account.balance : 0,
        }));
    } catch {
      return defaultInsightAccounts;
    }
  });
  const [showInsightAccountForm, setShowInsightAccountForm] = useState(false);
  const [insightAccountForm, setInsightAccountForm] = useState({
    name: "",
    type: "asset" as InsightAccountType,
    balance: "",
  });
  const [mortgageForm, setMortgageForm] = useState<MortgageForm>(() => {
    const saved = localStorage.getItem("budget-insight-mortgage-form");
    if (!saved) return defaultMortgageForm;
    try {
      const parsed = JSON.parse(saved) as Partial<MortgageForm>;
      return {
        homePrice: typeof parsed.homePrice === "string" ? parsed.homePrice : defaultMortgageForm.homePrice,
        downPayment: typeof parsed.downPayment === "string" ? parsed.downPayment : defaultMortgageForm.downPayment,
        interestRate: typeof parsed.interestRate === "string" ? parsed.interestRate : defaultMortgageForm.interestRate,
        termYears: typeof parsed.termYears === "string" ? parsed.termYears : defaultMortgageForm.termYears,
        propertyTaxAnnual:
          typeof parsed.propertyTaxAnnual === "string" ? parsed.propertyTaxAnnual : defaultMortgageForm.propertyTaxAnnual,
        insuranceAnnual:
          typeof parsed.insuranceAnnual === "string" ? parsed.insuranceAnnual : defaultMortgageForm.insuranceAnnual,
        hoaMonthly: typeof parsed.hoaMonthly === "string" ? parsed.hoaMonthly : defaultMortgageForm.hoaMonthly,
        pmiMonthly: typeof parsed.pmiMonthly === "string" ? parsed.pmiMonthly : defaultMortgageForm.pmiMonthly,
      };
    } catch {
      return defaultMortgageForm;
    }
  });
  const [plaidStatus, setPlaidStatus] = useState<PlaidStatus | null>(null);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [plaidMessage, setPlaidMessage] = useState<string | null>(null);
  const [plaidSyncBusy, setPlaidSyncBusy] = useState(false);
  const [plaidSyncedTransactions, setPlaidSyncedTransactions] = useState<PlaidSyncedTransactionPreview[]>([]);
  const [plaidHistoryDaysRequested, setPlaidHistoryDaysRequested] = useState<number>(() => {
    const saved = localStorage.getItem("budget-plaid-days-requested");
    const parsed = Number(saved ?? "365");
    if (!Number.isFinite(parsed)) return 365;
    return Math.min(Math.max(Math.floor(parsed), 30), 730);
  });
  const [plaidAutoFilterEnabled, setPlaidAutoFilterEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("budget-plaid-auto-filter");
    if (!saved) return true;
    return saved !== "false";
  });
  const [rentVsBuyForm, setRentVsBuyForm] = useState<RentVsBuyForm>(() => {
    const saved = localStorage.getItem("budget-insight-rent-vs-buy-form");
    if (!saved) return defaultRentVsBuyForm;
    try {
      const parsed = JSON.parse(saved) as Partial<RentVsBuyForm>;
      return {
        homePrice: typeof parsed.homePrice === "string" ? parsed.homePrice : defaultRentVsBuyForm.homePrice,
        downPayment: typeof parsed.downPayment === "string" ? parsed.downPayment : defaultRentVsBuyForm.downPayment,
        interestRate: typeof parsed.interestRate === "string" ? parsed.interestRate : defaultRentVsBuyForm.interestRate,
        termYears: typeof parsed.termYears === "string" ? parsed.termYears : defaultRentVsBuyForm.termYears,
        propertyTaxAnnual:
          typeof parsed.propertyTaxAnnual === "string" ? parsed.propertyTaxAnnual : defaultRentVsBuyForm.propertyTaxAnnual,
        insuranceAnnual:
          typeof parsed.insuranceAnnual === "string" ? parsed.insuranceAnnual : defaultRentVsBuyForm.insuranceAnnual,
        hoaMonthly: typeof parsed.hoaMonthly === "string" ? parsed.hoaMonthly : defaultRentVsBuyForm.hoaMonthly,
        pmiMonthly: typeof parsed.pmiMonthly === "string" ? parsed.pmiMonthly : defaultRentVsBuyForm.pmiMonthly,
        maintenanceRatePct:
          typeof parsed.maintenanceRatePct === "string"
            ? parsed.maintenanceRatePct
            : defaultRentVsBuyForm.maintenanceRatePct,
        closingCostPct:
          typeof parsed.closingCostPct === "string" ? parsed.closingCostPct : defaultRentVsBuyForm.closingCostPct,
        sellCostPct: typeof parsed.sellCostPct === "string" ? parsed.sellCostPct : defaultRentVsBuyForm.sellCostPct,
        appreciationPct:
          typeof parsed.appreciationPct === "string" ? parsed.appreciationPct : defaultRentVsBuyForm.appreciationPct,
        rentMonthly: typeof parsed.rentMonthly === "string" ? parsed.rentMonthly : defaultRentVsBuyForm.rentMonthly,
        rentIncreasePct:
          typeof parsed.rentIncreasePct === "string" ? parsed.rentIncreasePct : defaultRentVsBuyForm.rentIncreasePct,
        investReturnPct:
          typeof parsed.investReturnPct === "string" ? parsed.investReturnPct : defaultRentVsBuyForm.investReturnPct,
        horizonYears:
          typeof parsed.horizonYears === "string" ? parsed.horizonYears : defaultRentVsBuyForm.horizonYears,
      };
    } catch {
      return defaultRentVsBuyForm;
    }
  });
  const [paydownVsInvestForm, setPaydownVsInvestForm] = useState<PaydownVsInvestForm>(() => {
    const saved = localStorage.getItem("budget-insight-paydown-vs-invest-form");
    if (!saved) return defaultPaydownVsInvestForm;
    try {
      const parsed = JSON.parse(saved) as Partial<PaydownVsInvestForm>;
      return {
        mortgageBalance:
          typeof parsed.mortgageBalance === "string" ? parsed.mortgageBalance : defaultPaydownVsInvestForm.mortgageBalance,
        mortgageRatePct:
          typeof parsed.mortgageRatePct === "string" ? parsed.mortgageRatePct : defaultPaydownVsInvestForm.mortgageRatePct,
        yearsRemaining:
          typeof parsed.yearsRemaining === "string" ? parsed.yearsRemaining : defaultPaydownVsInvestForm.yearsRemaining,
        extraMonthly:
          typeof parsed.extraMonthly === "string" ? parsed.extraMonthly : defaultPaydownVsInvestForm.extraMonthly,
        investReturnPct:
          typeof parsed.investReturnPct === "string" ? parsed.investReturnPct : defaultPaydownVsInvestForm.investReturnPct,
      };
    } catch {
      return defaultPaydownVsInvestForm;
    }
  });

  const [transactionForm, setTransactionForm] = useState({
    description: "",
    amount: "",
    type: "expense" as TransactionType,
    category: "Food",
    date: `${selectedMonthKey}-01`,
  });
  const [inlineEditingTransactionId, setInlineEditingTransactionId] = useState<number | null>(null);
  const [inlineTransactionDraft, setInlineTransactionDraft] = useState({
    description: "",
    amount: "",
    type: "expense" as TransactionType,
    category: "Food",
    date: `${selectedMonthKey}-01`,
  });
  const [inlineEditingCategoryId, setInlineEditingCategoryId] = useState<number | null>(null);
  const [inlineCategoryDraft, setInlineCategoryDraft] = useState({
    name: "",
    budgeted: "",
    rolloverMode: "to_unallocated" as RolloverMode,
    icon: "auto" as CategoryIconChoice,
  });
  const [inlineEditingGoalId, setInlineEditingGoalId] = useState<number | null>(null);
  const [inlineGoalDraft, setInlineGoalDraft] = useState({
    name: "",
    targetAmount: "",
  });
  const [inlineEditingContributionId, setInlineEditingContributionId] = useState<number | null>(null);
  const [inlineContributionDraft, setInlineContributionDraft] = useState({
    amount: "",
    date: `${selectedMonthKey}-01`,
    note: "",
  });
  const [plannerExpandedGoalId, setPlannerExpandedGoalId] = useState<number | null>(null);
  const [plannerConfigs, setPlannerConfigs] = useState<Record<number, PlannerConfig>>(() => {
    const saved = localStorage.getItem("budget-planner-configs");
    if (!saved) return {};
    try {
      return JSON.parse(saved) as Record<number, PlannerConfig>;
    } catch {
      return {};
    }
  });
  const [plannerMarketByGoal, setPlannerMarketByGoal] = useState<Record<number, PlannerMarketState>>({});
  const [plannerMarketWindowByGoal, setPlannerMarketWindowByGoal] = useState<Record<number, MarketWindow>>(() => {
    const saved = localStorage.getItem("budget-planner-market-window");
    if (!saved) return {};
    try {
      return JSON.parse(saved) as Record<number, MarketWindow>;
    } catch {
      return {};
    }
  });
  const [plannerReturnLookbackByGoal, setPlannerReturnLookbackByGoal] = useState<Record<number, ReturnLookbackWindow>>(() => {
    const saved = localStorage.getItem("budget-planner-return-lookback");
    if (!saved) return {};
    try {
      return JSON.parse(saved) as Record<number, ReturnLookbackWindow>;
    } catch {
      return {};
    }
  });
  const [plannerAllocationPanelOpenByGoal, setPlannerAllocationPanelOpenByGoal] = useState<Record<number, boolean>>(() => {
    const saved = localStorage.getItem("budget-planner-allocation-panel-open");
    if (!saved) return {};
    try {
      return JSON.parse(saved) as Record<number, boolean>;
    } catch {
      return {};
    }
  });
  const [plannerRiskInfoOpenByGoal, setPlannerRiskInfoOpenByGoal] = useState<Record<number, RiskInfoKey | null>>({});
  const [draggingCategoryId, setDraggingCategoryId] = useState<number | null>(null);
  const [categoryDropTargetId, setCategoryDropTargetId] = useState<number | null>(null);
  const [draggingGoalId, setDraggingGoalId] = useState<number | null>(null);
  const [goalDropTargetId, setGoalDropTargetId] = useState<number | null>(null);

  const [categoryForm, setCategoryForm] = useState({
    name: "",
    budgeted: "",
    rolloverMode: "to_unallocated" as RolloverMode,
    icon: "auto" as CategoryIconChoice,
  });
  const [goalForm, setGoalForm] = useState({ name: "", targetAmount: "" });
  const [contributionForm, setContributionForm] = useState({ amount: "", date: `${selectedMonthKey}-01`, note: "" });

  useEffect(() => {
    localStorage.setItem("budget-categories", JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    localStorage.setItem("budget-projected-income", JSON.stringify(projectedIncomeByMonth));
  }, [projectedIncomeByMonth]);

  useEffect(() => {
    localStorage.setItem("budget-transactions", JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem("budget-savings-goals", JSON.stringify(goals));
  }, [goals]);

  useEffect(() => {
    localStorage.setItem("budget-savings-contributions", JSON.stringify(contributions));
  }, [contributions]);

  useEffect(() => {
    localStorage.setItem("budget-insight-accounts", JSON.stringify(insightAccounts));
  }, [insightAccounts]);

  useEffect(() => {
    localStorage.setItem("budget-insight-mortgage-form", JSON.stringify(mortgageForm));
  }, [mortgageForm]);
  useEffect(() => {
    localStorage.setItem("budget-insight-rent-vs-buy-form", JSON.stringify(rentVsBuyForm));
  }, [rentVsBuyForm]);
  useEffect(() => {
    localStorage.setItem("budget-insight-paydown-vs-invest-form", JSON.stringify(paydownVsInvestForm));
  }, [paydownVsInvestForm]);

  useEffect(() => {
    localStorage.setItem("budget-plaid-auto-filter", plaidAutoFilterEnabled ? "true" : "false");
  }, [plaidAutoFilterEnabled]);
  useEffect(() => {
    localStorage.setItem("budget-plaid-days-requested", String(plaidHistoryDaysRequested));
  }, [plaidHistoryDaysRequested]);

  useEffect(() => {
    localStorage.setItem("budget-dark-mode", isDarkMode ? "true" : "false");
    document.body.classList.toggle("dark-mode", isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem("budget-planner-configs", JSON.stringify(plannerConfigs));
  }, [plannerConfigs]);

  useEffect(() => {
    localStorage.setItem("budget-planner-market-window", JSON.stringify(plannerMarketWindowByGoal));
  }, [plannerMarketWindowByGoal]);

  useEffect(() => {
    localStorage.setItem("budget-planner-return-lookback", JSON.stringify(plannerReturnLookbackByGoal));
  }, [plannerReturnLookbackByGoal]);

  useEffect(() => {
    localStorage.setItem("budget-planner-allocation-panel-open", JSON.stringify(plannerAllocationPanelOpenByGoal));
  }, [plannerAllocationPanelOpenByGoal]);

  useEffect(() => {
    const today = new Date();
    const defaultTargetDate = `${today.getFullYear() + 5}-12-31`;

    setPlannerConfigs((current) => {
      const next = { ...current };

      goals.forEach((goal) => {
        const goalCurrentSaved = contributions
          .filter((contribution) => contribution.goalId === goal.id)
          .reduce((sum, contribution) => sum + contribution.amount, 0);
        const existing = next[goal.id] as Partial<PlannerConfig> | undefined;
        const inferredRetirementFromName = /retirement|401k|403b|ira|roth/i.test(goal.name);
        const legacyFixedApr =
          Array.isArray((existing as { holdings?: { type?: string; apr?: string }[] })?.holdings)
            ? (existing as { holdings?: { type?: string; apr?: string }[] }).holdings?.find(
                (holding) => holding.type === "fixed",
              )?.apr
            : undefined;
        const defaultAllocations = [
          {
            symbol: "SPY",
            percent: "70",
            dollars: ((goalCurrentSaved * 70) / 100).toFixed(2),
          },
          {
            symbol: "VEA",
            percent: "30",
            dollars: ((goalCurrentSaved * 30) / 100).toFixed(2),
          },
        ];
        const normalizedExistingAllocations =
          Array.isArray(existing?.allocations) && existing.allocations.length > 0
            ? existing.allocations.map((allocation) => ({
                symbol: typeof allocation.symbol === "string" ? allocation.symbol : "",
                percent: typeof allocation.percent === "string" ? allocation.percent : "",
                dollars: typeof allocation.dollars === "string" ? allocation.dollars : "",
              }))
            : defaultAllocations;

        next[goal.id] = {
          targetDate:
            typeof existing?.targetDate === "string" && existing.targetDate.length > 0
              ? existing.targetDate
              : defaultTargetDate,
          allocations: normalizedExistingAllocations,
          planMode:
            existing?.planMode === "contribution" || existing?.planMode === "confidence"
              ? existing.planMode
              : "confidence",
          monthlyContribution:
            typeof existing?.monthlyContribution === "string" ? existing.monthlyContribution : "300",
          targetConfidence:
            typeof existing?.targetConfidence === "string" ? existing.targetConfidence : "70",
          trackingMode:
            existing?.trackingMode === "fixed" || existing?.trackingMode === "market"
              ? existing.trackingMode
              : "market",
          fixedApr:
            typeof existing?.fixedApr === "string"
              ? existing.fixedApr
              : typeof legacyFixedApr === "string"
                ? legacyFixedApr
                : "4.0",
          isRetirementAccount:
            typeof existing?.isRetirementAccount === "boolean"
              ? existing.isRetirementAccount
              : inferredRetirementFromName,
          retirementAnnualSpendGoal:
            typeof existing?.retirementAnnualSpendGoal === "string"
              ? existing.retirementAnnualSpendGoal
              : "60000",
          safeWithdrawalRate:
            typeof existing?.safeWithdrawalRate === "string" ? existing.safeWithdrawalRate : "4.0",
          retirementTargetMode:
            existing?.retirementTargetMode === "preserve_principal" || existing?.retirementTargetMode === "swr"
              ? existing.retirementTargetMode
              : "swr",
          expectedRealReturn:
            typeof existing?.expectedRealReturn === "string" ? existing.expectedRealReturn : "3.0",
          taxHouseholdIncome:
            typeof existing?.taxHouseholdIncome === "string" ? existing.taxHouseholdIncome : "140000",
          taxFilingStatus:
            existing?.taxFilingStatus === "single" || existing?.taxFilingStatus === "married_joint"
              ? existing.taxFilingStatus
              : "married_joint",
          taxStateCode:
            typeof existing?.taxStateCode === "string" && existing.taxStateCode.length > 0
              ? existing.taxStateCode
              : "TX",
          taxAccountType:
            existing?.taxAccountType === "traditional_401k" ||
            existing?.taxAccountType === "roth_401k" ||
            existing?.taxAccountType === "taxable_mixed"
              ? existing.taxAccountType
              : "traditional_401k",
          taxableWithdrawalGoal:
            typeof existing?.taxableWithdrawalGoal === "string"
              ? existing.taxableWithdrawalGoal
              : String(goal.targetAmount),
          taxableCostBasisPercent:
            typeof existing?.taxableCostBasisPercent === "string"
              ? existing.taxableCostBasisPercent
              : "75",
          costBasisMode:
            existing?.costBasisMode === "manual" || existing?.costBasisMode === "auto"
              ? existing.costBasisMode
              : "auto",
          benchmarkSymbol:
            typeof existing?.benchmarkSymbol === "string" && existing.benchmarkSymbol.trim().length > 0
              ? existing.benchmarkSymbol.trim().toUpperCase()
              : "SPY",
          riskFreeRate:
            typeof existing?.riskFreeRate === "string" ? existing.riskFreeRate : "2.0",
        };
      });

      Object.keys(next).forEach((idKey) => {
        const goalId = Number(idKey);
        if (!goals.some((goal) => goal.id === goalId)) delete next[goalId];
      });

      return next;
    });

    setPlannerAllocationPanelOpenByGoal((current) => {
      const next = { ...current };

      goals.forEach((goal) => {
        if (next[goal.id] === undefined) next[goal.id] = true;
      });

      Object.keys(next).forEach((idKey) => {
        const goalId = Number(idKey);
        if (!goals.some((goal) => goal.id === goalId)) delete next[goalId];
      });

      return next;
    });

    setPlannerRiskInfoOpenByGoal((current) => {
      const next = { ...current };
      goals.forEach((goal) => {
        if (next[goal.id] === undefined) next[goal.id] = null;
      });
      Object.keys(next).forEach((idKey) => {
        const goalId = Number(idKey);
        if (!goals.some((goal) => goal.id === goalId)) delete next[goalId];
      });
      return next;
    });

    setPlannerMarketWindowByGoal((current) => {
      const next = { ...current };

      goals.forEach((goal) => {
        if (!next[goal.id]) next[goal.id] = "1D";
      });

      Object.keys(next).forEach((idKey) => {
        const goalId = Number(idKey);
        if (!goals.some((goal) => goal.id === goalId)) delete next[goalId];
      });

      return next;
    });

    setPlannerReturnLookbackByGoal((current) => {
      const next = { ...current };

      goals.forEach((goal) => {
        if (!next[goal.id]) next[goal.id] = "2Y";
      });

      Object.keys(next).forEach((idKey) => {
        const goalId = Number(idKey);
        if (!goals.some((goal) => goal.id === goalId)) delete next[goalId];
      });

      return next;
    });

    if (goals.length === 0) {
      setPlannerExpandedGoalId(null);
      return;
    }

    const hasExpandedGoal =
      plannerExpandedGoalId !== null && goals.some((goal) => goal.id === plannerExpandedGoalId);
    if (!hasExpandedGoal) setPlannerExpandedGoalId(goals[0].id);
  }, [goals, plannerExpandedGoalId, contributions]);

  useEffect(() => {
    if (activeView !== "goal_planning") return;
    if (plannerExpandedGoalId === null) return;

    const config = plannerConfigs[plannerExpandedGoalId];
    if (!config) return;

    const currentSavedForGoal = contributions
      .filter((contribution) => contribution.goalId === plannerExpandedGoalId)
      .reduce((sum, contribution) => sum + contribution.amount, 0);

    const allocations = sanitizeAllocations(
      config.allocations,
      currentSavedForGoal,
    );
    const rules = allocationValidation(config.allocations);
    const hasValidWeights = rules.hasExactHundred && rules.hasPositiveDollarTotal;
    const hasSymbolIssues =
      rules.duplicateSymbols.length > 0 || rules.invalidSymbolInputs.length > 0;
    const benchmarkSymbol = config.benchmarkSymbol.trim().toUpperCase();
    const uniqueSymbols = Array.from(
      new Set([
        ...allocations.map((allocation) => allocation.symbol),
        ...(benchmarkSymbol ? [benchmarkSymbol] : []),
      ]),
    );

    if (config.trackingMode === "fixed" || uniqueSymbols.length === 0 || !hasValidWeights || hasSymbolIssues) {
      setPlannerMarketByGoal((current) => ({
        ...current,
        [plannerExpandedGoalId]: {
          status: "idle",
          quotes: [],
        },
      }));
      return;
    }

    let isCancelled = false;

    setPlannerMarketByGoal((current) => ({
      ...current,
      [plannerExpandedGoalId]: {
        status: "loading",
        quotes: current[plannerExpandedGoalId]?.quotes ?? [],
      },
    }));

    const query = encodeURIComponent(uniqueSymbols.join(","));
    fetch(`/api/market/quotes?symbols=${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as { fetchedAt: string; quotes: MarketQuote[]; error?: string };
      })
      .then((data) => {
        if (isCancelled) return;
        setPlannerMarketByGoal((current) => ({
          ...current,
          [plannerExpandedGoalId]: {
            status: data.error ? "error" : "success",
            fetchedAt: data.fetchedAt,
            quotes: data.quotes ?? [],
            error: data.error,
          },
        }));
      })
      .catch(() => {
        if (isCancelled) return;
        setPlannerMarketByGoal((current) => ({
          ...current,
          [plannerExpandedGoalId]: {
            status: "error",
            quotes: [],
            error: "Could not load market data. Make sure the dev server is running.",
          },
        }));
      });

    return () => {
      isCancelled = true;
    };
  }, [activeView, plannerExpandedGoalId, plannerConfigs, contributions]);

  useEffect(() => {
    setInlineEditingTransactionId(null);
    setInlineEditingCategoryId(null);
    setInlineEditingGoalId(null);
    setInlineEditingContributionId(null);
  }, [selectedMonthKey]);

  useEffect(() => {
    const hasInlineEditOpen =
      inlineEditingTransactionId !== null ||
      inlineEditingCategoryId !== null ||
      inlineEditingGoalId !== null ||
      inlineEditingContributionId !== null;

    if (!hasInlineEditOpen) return;

    function onWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();

      setInlineEditingTransactionId(null);
      setInlineEditingCategoryId(null);
      setInlineEditingGoalId(null);
      setInlineEditingContributionId(null);
    }

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    inlineEditingTransactionId,
    inlineEditingCategoryId,
    inlineEditingGoalId,
    inlineEditingContributionId,
  ]);

  const spentByMonthCategory = useMemo(() => {
    const spentTotals = new Map<string, number>();

    transactions.forEach((transaction) => {
      if (transaction.type !== "expense") return;
      const key = `${monthFromDate(transaction.date)}|${transaction.category}`;
      spentTotals.set(key, (spentTotals.get(key) ?? 0) + transaction.amount);
    });

    return spentTotals;
  }, [transactions]);

  function spentForCategoryInMonth(categoryName: string, monthKey: string) {
    return spentByMonthCategory.get(`${monthKey}|${categoryName}`) ?? 0;
  }

  function nextCategoryId(current: Category[]) {
    return current.reduce((maxId, category) => Math.max(maxId, category.id), 0) + 1;
  }

  useEffect(() => {
    const hasCurrentMonthCategories = categories.some(
      (category) => category.monthKey === selectedMonthKey,
    );
    if (hasCurrentMonthCategories) return;

    const previousMonthKeys = Array.from(
      new Set(
        categories
          .map((category) => category.monthKey)
          .filter((monthKey) => compareMonthKeys(monthKey, selectedMonthKey) < 0),
      ),
    ).sort(compareMonthKeys);

    const latestPreviousMonthKey = previousMonthKeys.at(-1);
    if (!latestPreviousMonthKey) return;

    const previousMonthCategories = categories.filter(
      (category) => category.monthKey === latestPreviousMonthKey,
    );
    if (previousMonthCategories.length === 0) return;

    const rolloverDeficit = previousMonthCategories.reduce((totalDeficit, rawCategory) => {
      const category = normalizeCategory(rawCategory);
      if (category.rolloverMode !== "to_category") return totalDeficit;
      const previousMonthSpent =
        spentByMonthCategory.get(`${latestPreviousMonthKey}|${category.name}`) ?? 0;
      const leftover = category.budgeted - previousMonthSpent;
      return leftover < 0 ? totalDeficit + Math.abs(leftover) : totalDeficit;
    }, 0);

    setCategories((current) => {
      if (current.some((category) => category.monthKey === selectedMonthKey)) return current;

      let idCounter = nextCategoryId(current);
      const copied = previousMonthCategories.map((rawCategory) => {
        const category = normalizeCategory(rawCategory);
        const previousMonthSpent =
          spentByMonthCategory.get(`${latestPreviousMonthKey}|${category.name}`) ?? 0;
        const leftover = category.budgeted - previousMonthSpent;

        return {
          id: idCounter++,
          name: category.name,
          baseBudgeted: category.baseBudgeted,
          budgeted:
            category.rolloverMode === "to_category"
              ? category.baseBudgeted + leftover
              : category.baseBudgeted,
          monthKey: selectedMonthKey,
          rolloverMode: category.rolloverMode,
          icon: category.icon,
        };
      });

      return [...current, ...copied];
    });

    if (rolloverDeficit <= 0) return;

    setContributions((currentContributions) => {
      const unallocatedThroughPreviousMonth =
        transactions.reduce((running, transaction) => {
          if (compareMonthKeys(monthFromDate(transaction.date), latestPreviousMonthKey) > 0) {
            return running;
          }
          return running + (transaction.type === "income" ? transaction.amount : -transaction.amount);
        }, 0) -
        currentContributions.reduce((running, contribution) => {
          if (compareMonthKeys(monthFromDate(contribution.date), latestPreviousMonthKey) > 0) {
            return running;
          }
          return running + contribution.amount;
        }, 0);

      const deficitAfterUnallocated = rolloverDeficit - Math.max(unallocatedThroughPreviousMonth, 0);
      if (deficitAfterUnallocated <= 0) return currentContributions;

      const emergencyGoal = goals.find(
        (goal) => goal.name.trim().toLowerCase() === "emergency fund",
      );
      if (!emergencyGoal) return currentContributions;

      const emergencyBalanceToDate = currentContributions.reduce((running, contribution) => {
        if (contribution.goalId !== emergencyGoal.id) return running;
        if (compareMonthKeys(monthFromDate(contribution.date), latestPreviousMonthKey) > 0) {
          return running;
        }
        return running + contribution.amount;
      }, 0);

      const emergencyWithdrawal = Math.min(
        Math.max(emergencyBalanceToDate, 0),
        deficitAfterUnallocated,
      );
      if (emergencyWithdrawal <= 0) return currentContributions;

      const nextContributionId =
        currentContributions.reduce(
          (maxId, contribution) => Math.max(maxId, contribution.id),
          0,
        ) + 1;

      return [
        {
          id: nextContributionId,
          goalId: emergencyGoal.id,
          amount: -emergencyWithdrawal,
          date: monthEndDate(latestPreviousMonthKey),
          note: `Auto rollover coverage for ${formatMonthLabel(latestPreviousMonthKey)}`,
        },
        ...currentContributions,
      ];
    });
  }, [selectedMonthKey, categories, spentByMonthCategory, transactions, goals]);

  useEffect(() => {
    if (!pendingResetMonth) return;
    if (pendingResetMonth === selectedMonthKey) return;

    setCategories((current) => current.filter((category) => category.monthKey !== pendingResetMonth));
    setProjectedIncomeByMonth((current) => {
      const next = { ...current };
      delete next[pendingResetMonth];
      return next;
    });
    setTransactions((current) =>
      current.filter((transaction) => monthFromDate(transaction.date) !== pendingResetMonth),
    );
    setContributions((current) =>
      current.filter((contribution) => monthFromDate(contribution.date) !== pendingResetMonth),
    );
    setPendingResetMonth(null);
  }, [pendingResetMonth, selectedMonthKey]);

  const currentMonthCategories = useMemo(
    () => categories.filter((category) => category.monthKey === selectedMonthKey),
    [categories, selectedMonthKey],
  );

  const currentMonthTransactions = useMemo(
    () => transactions.filter((transaction) => monthFromDate(transaction.date) === selectedMonthKey),
    [transactions, selectedMonthKey],
  );

  const { totalIncome, totalExpenses } = useMemo(() => {
    return transactions.reduce(
      (totals, transaction) => {
        if (transaction.type === "income") totals.totalIncome += transaction.amount;
        if (transaction.type === "expense") totals.totalExpenses += transaction.amount;
        return totals;
      },
      { totalIncome: 0, totalExpenses: 0 },
    );
  }, [transactions]);

  const { incomeReceived, amountSpent } = useMemo(() => {
    return currentMonthTransactions.reduce(
      (totals, transaction) => {
        if (transaction.type === "income") totals.incomeReceived += transaction.amount;
        if (transaction.type === "expense") totals.amountSpent += transaction.amount;
        return totals;
      },
      { incomeReceived: 0, amountSpent: 0 },
    );
  }, [currentMonthTransactions]);

  const projectedIncome = projectedIncomeByMonth[selectedMonthKey] ?? 0;

  const projectedExpenses = useMemo(
    () => currentMonthCategories.reduce((sum, category) => sum + category.budgeted, 0),
    [currentMonthCategories],
  );

  const savingsBalance = totalIncome - totalExpenses;
  const savedThisMonth = incomeReceived - amountSpent;

  const savingsToDate = useMemo(() => {
    const totals = {
      incomeToDate: 0,
      expensesToDate: 0,
      allocatedToDate: 0,
    };

    transactions.forEach((transaction) => {
      if (compareMonthKeys(monthFromDate(transaction.date), selectedMonthKey) > 0) return;
      if (transaction.type === "income") totals.incomeToDate += transaction.amount;
      if (transaction.type === "expense") totals.expensesToDate += transaction.amount;
    });

    contributions.forEach((contribution) => {
      if (compareMonthKeys(monthFromDate(contribution.date), selectedMonthKey) > 0) return;
      totals.allocatedToDate += contribution.amount;
    });

    const savingsBalanceToDate = totals.incomeToDate - totals.expensesToDate;
    const unallocatedToDate = savingsBalanceToDate - totals.allocatedToDate;

    return {
      ...totals,
      savingsBalanceToDate,
      unallocatedToDate,
    };
  }, [transactions, contributions, selectedMonthKey]);

  const unallocatedSavings = savingsToDate.unallocatedToDate;

  const insightNetWorth = useMemo(() => {
    return insightAccounts.reduce(
      (totals, account) => {
        if (account.type === "asset") totals.assets += account.balance;
        else totals.liabilities += account.balance;
        return totals;
      },
      { assets: 0, liabilities: 0 },
    );
  }, [insightAccounts]);
  const netWorthValue = insightNetWorth.assets - insightNetWorth.liabilities;

  const netWorthTrend = useMemo(() => {
    const monthSet = new Set<string>();
    transactions.forEach((transaction) => monthSet.add(monthFromDate(transaction.date)));
    monthSet.add(selectedMonthKey);
    const months = Array.from(monthSet).sort(compareMonthKeys);
    if (months.length === 0) return [] as { monthKey: string; value: number }[];
    const lastMonths = months.slice(-6);
    const currentCashNet = totalIncome - totalExpenses;
    const manualOffset = netWorthValue - currentCashNet;
    return lastMonths.map((monthKey) => {
      const cashNetThroughMonth = transactions.reduce((running, transaction) => {
        if (compareMonthKeys(monthFromDate(transaction.date), monthKey) > 0) return running;
        return running + (transaction.type === "income" ? transaction.amount : -transaction.amount);
      }, 0);
      return {
        monthKey,
        value: cashNetThroughMonth + manualOffset,
      };
    });
  }, [transactions, selectedMonthKey, totalIncome, totalExpenses, netWorthValue]);

  const mortgageSummary = useMemo(() => {
    const homePrice = Math.max(Number(mortgageForm.homePrice) || 0, 0);
    const downPayment = Math.max(Number(mortgageForm.downPayment) || 0, 0);
    const interestRatePct = Math.max(Number(mortgageForm.interestRate) || 0, 0);
    const termYears = Math.max(Math.floor(Number(mortgageForm.termYears) || 0), 0);
    const propertyTaxAnnual = Math.max(Number(mortgageForm.propertyTaxAnnual) || 0, 0);
    const insuranceAnnual = Math.max(Number(mortgageForm.insuranceAnnual) || 0, 0);
    const hoaMonthly = Math.max(Number(mortgageForm.hoaMonthly) || 0, 0);
    const pmiMonthly = Math.max(Number(mortgageForm.pmiMonthly) || 0, 0);
    const principal = Math.max(homePrice - downPayment, 0);
    const n = termYears * 12;
    const monthlyRate = interestRatePct / 100 / 12;
    const monthlyPI =
      principal <= 0 || n <= 0
        ? 0
        : monthlyRate === 0
          ? principal / n
          : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -n);
    const monthlyTax = propertyTaxAnnual / 12;
    const monthlyInsurance = insuranceAnnual / 12;
    const monthlyTotal = monthlyPI + monthlyTax + monthlyInsurance + hoaMonthly + pmiMonthly;
    const totalPaid = monthlyPI * n;
    const totalInterest = Math.max(totalPaid - principal, 0);
    return {
      homePrice,
      downPayment,
      principal,
      termYears,
      monthlyPI,
      monthlyTax,
      monthlyInsurance,
      hoaMonthly,
      pmiMonthly,
      monthlyTotal,
      totalInterest,
    };
  }, [mortgageForm]);
  const rentVsBuySummary = useMemo(() => {
    const homePrice = Math.max(Number(rentVsBuyForm.homePrice) || 0, 0);
    const downPayment = Math.max(Number(rentVsBuyForm.downPayment) || 0, 0);
    const interestRatePct = Math.max(Number(rentVsBuyForm.interestRate) || 0, 0);
    const termYears = Math.max(Math.floor(Number(rentVsBuyForm.termYears) || 0), 0);
    const propertyTaxAnnual = Math.max(Number(rentVsBuyForm.propertyTaxAnnual) || 0, 0);
    const insuranceAnnual = Math.max(Number(rentVsBuyForm.insuranceAnnual) || 0, 0);
    const hoaMonthly = Math.max(Number(rentVsBuyForm.hoaMonthly) || 0, 0);
    const pmiMonthly = Math.max(Number(rentVsBuyForm.pmiMonthly) || 0, 0);
    const maintenanceRatePct = Math.max(Number(rentVsBuyForm.maintenanceRatePct) || 0, 0);
    const closingCostPct = Math.max(Number(rentVsBuyForm.closingCostPct) || 0, 0);
    const sellCostPct = Math.max(Number(rentVsBuyForm.sellCostPct) || 0, 0);
    const appreciationPct = Math.max(Number(rentVsBuyForm.appreciationPct) || 0, 0);
    const rentMonthly = Math.max(Number(rentVsBuyForm.rentMonthly) || 0, 0);
    const rentIncreasePct = Math.max(Number(rentVsBuyForm.rentIncreasePct) || 0, 0);
    const investReturnPct = Math.max(Number(rentVsBuyForm.investReturnPct) || 0, 0);
    const horizonYears = Math.max(Math.floor(Number(rentVsBuyForm.horizonYears) || 0), 1);

    const loanPrincipal = Math.max(homePrice - downPayment, 0);
    const loanMonths = Math.max(termYears * 12, 1);
    const monthlyRate = interestRatePct / 100 / 12;
    const monthlyPI =
      loanPrincipal <= 0
        ? 0
        : monthlyRate === 0
          ? loanPrincipal / loanMonths
          : (loanPrincipal * monthlyRate) / (1 - (1 + monthlyRate) ** -loanMonths);
    const monthlyOwnerNonPI = propertyTaxAnnual / 12 + insuranceAnnual / 12 + hoaMonthly + pmiMonthly + (homePrice * (maintenanceRatePct / 100)) / 12;
    const monthlyOwnerTotal = monthlyPI + monthlyOwnerNonPI;
    const horizonMonths = horizonYears * 12;
    const upfrontCost = downPayment + homePrice * (closingCostPct / 100);
    const totalOwnerOutflow = upfrontCost + monthlyOwnerTotal * horizonMonths;

    const homeValueAtEnd = homePrice * (1 + appreciationPct / 100) ** horizonYears;
    const paidBalance =
      monthlyRate === 0
        ? Math.max(loanPrincipal - monthlyPI * horizonMonths, 0)
        : Math.max(
            loanPrincipal * (1 + monthlyRate) ** horizonMonths -
              monthlyPI * (((1 + monthlyRate) ** horizonMonths - 1) / monthlyRate),
            0,
          );
    const saleProceeds = homeValueAtEnd * (1 - sellCostPct / 100);
    const equityAtEnd = Math.max(saleProceeds - paidBalance, 0);
    const ownerNetCost = totalOwnerOutflow - equityAtEnd;

    let totalRentPaid = 0;
    for (let year = 0; year < horizonYears; year += 1) {
      const yearRent = rentMonthly * (1 + rentIncreasePct / 100) ** year;
      totalRentPaid += yearRent * 12;
    }
    const investMonthlyRate = investReturnPct / 100 / 12;
    const fvUpfront = upfrontCost * (1 + investMonthlyRate) ** horizonMonths;
    const monthlyDiff = Math.max(monthlyOwnerTotal - rentMonthly, 0);
    const fvMonthlyDiff =
      investMonthlyRate === 0
        ? monthlyDiff * horizonMonths
        : monthlyDiff * (((1 + investMonthlyRate) ** horizonMonths - 1) / investMonthlyRate);
    const renterEndingInvestments = fvUpfront + fvMonthlyDiff;
    const renterNetCost = totalRentPaid - renterEndingInvestments;
    const buyVsRentDelta = renterNetCost - ownerNetCost;

    return {
      horizonYears,
      monthlyOwnerTotal,
      totalRentPaid,
      ownerNetCost,
      renterNetCost,
      buyVsRentDelta,
      recommendation:
        buyVsRentDelta > 0
          ? "Buying is favored by this model over the selected horizon."
          : buyVsRentDelta < 0
            ? "Renting is favored by this model over the selected horizon."
            : "Buying and renting are roughly tied in this scenario.",
    };
  }, [rentVsBuyForm]);
  const paydownVsInvestSummary = useMemo(() => {
    const mortgageBalance = Math.max(Number(paydownVsInvestForm.mortgageBalance) || 0, 0);
    const mortgageRatePct = Math.max(Number(paydownVsInvestForm.mortgageRatePct) || 0, 0);
    const yearsRemaining = Math.max(Math.floor(Number(paydownVsInvestForm.yearsRemaining) || 0), 1);
    const extraMonthly = Math.max(Number(paydownVsInvestForm.extraMonthly) || 0, 0);
    const investReturnPct = Math.max(Number(paydownVsInvestForm.investReturnPct) || 0, 0);
    const horizonMonths = yearsRemaining * 12;
    const mortgageMonthlyRate = mortgageRatePct / 100 / 12;
    const investMonthlyRate = investReturnPct / 100 / 12;
    const scheduledMonthlyPayment =
      mortgageBalance <= 0
        ? 0
        : mortgageMonthlyRate === 0
          ? mortgageBalance / horizonMonths
          : (mortgageBalance * mortgageMonthlyRate) / (1 - (1 + mortgageMonthlyRate) ** -horizonMonths);

    let baseBalance = mortgageBalance;
    let paydownBalance = mortgageBalance;
    let baseInterestPaid = 0;
    let paydownInterestPaid = 0;
    let investPathPortfolio = 0;
    let paydownPathPortfolio = 0;
    let payoffMonthWithExtra = horizonMonths;

    for (let month = 1; month <= horizonMonths; month += 1) {
      if (investMonthlyRate > 0) {
        investPathPortfolio *= 1 + investMonthlyRate;
        paydownPathPortfolio *= 1 + investMonthlyRate;
      }

      investPathPortfolio += extraMonthly;

      if (baseBalance > 0) {
        const baseInterest = baseBalance * mortgageMonthlyRate;
        const basePrincipalPaid = Math.min(scheduledMonthlyPayment - baseInterest, baseBalance);
        baseBalance = Math.max(baseBalance - basePrincipalPaid, 0);
        baseInterestPaid += baseInterest;
      }

      if (paydownBalance > 0) {
        const paydownInterest = paydownBalance * mortgageMonthlyRate;
        const totalPaydownPayment = scheduledMonthlyPayment + extraMonthly;
        const paydownPrincipalPaid = Math.min(totalPaydownPayment - paydownInterest, paydownBalance);
        paydownBalance = Math.max(paydownBalance - paydownPrincipalPaid, 0);
        paydownInterestPaid += paydownInterest;
        if (paydownBalance <= 0 && payoffMonthWithExtra === horizonMonths) {
          payoffMonthWithExtra = month;
        }
      } else {
        paydownPathPortfolio += scheduledMonthlyPayment + extraMonthly;
      }
    }

    const paydownFutureValue = paydownPathPortfolio;
    const investFutureValue = investPathPortfolio;
    const delta = investFutureValue - paydownFutureValue;
    const interestSaved = Math.max(baseInterestPaid - paydownInterestPaid, 0);
    const monthsFreed = Math.max(horizonMonths - payoffMonthWithExtra, 0);

    return {
      yearsRemaining,
      extraMonthly,
      scheduledMonthlyPayment,
      paydownFutureValue,
      investFutureValue,
      delta,
      payoffMonthWithExtra,
      monthsFreed,
      interestSaved,
      breakEvenReturnPct: mortgageRatePct,
      recommendation:
        delta > 0
          ? "Investing the extra cash is favored by expected return."
          : delta < 0
            ? "Paying down the mortgage is favored by expected return."
            : "Both choices are roughly tied in this scenario.",
    };
  }, [paydownVsInvestForm]);

  function formatCurrency(value: number) {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function getUnallocatedCentsThroughMonth(
    monthKey: string,
    nextTransactions: Transaction[],
    nextContributions: SavingsContribution[],
  ) {
    const netFromTransactions = nextTransactions.reduce((running, transaction) => {
      if (compareMonthKeys(monthFromDate(transaction.date), monthKey) > 0) return running;
      return running + (transaction.type === "income" ? toCents(transaction.amount) : -toCents(transaction.amount));
    }, 0);

    const allocatedToGoals = nextContributions.reduce((running, contribution) => {
      if (compareMonthKeys(monthFromDate(contribution.date), monthKey) > 0) return running;
      return running + toCents(contribution.amount);
    }, 0);

    return netFromTransactions - allocatedToGoals;
  }

  function getMonthDeficitBreakdown(
    monthKey: string,
    nextTransactions: Transaction[],
    nextContributions: SavingsContribution[],
  ) {
    const monthIncome = nextTransactions
      .filter((transaction) => transaction.type === "income" && monthFromDate(transaction.date) === monthKey)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const monthExpenses = nextTransactions
      .filter((transaction) => transaction.type === "expense" && monthFromDate(transaction.date) === monthKey)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const monthAllocated = nextContributions
      .filter((contribution) => monthFromDate(contribution.date) === monthKey)
      .reduce((sum, contribution) => sum + contribution.amount, 0);

    const categoryOverages = categories
      .filter((category) => category.monthKey === monthKey)
      .reduce((sum, category) => {
        const categorySpent = nextTransactions
          .filter(
            (transaction) =>
              transaction.type === "expense" &&
              monthFromDate(transaction.date) === monthKey &&
              transaction.category === category.name,
          )
          .reduce((categorySum, transaction) => categorySum + transaction.amount, 0);

        const remaining = category.budgeted - categorySpent;
        return remaining < 0 ? sum + Math.abs(remaining) : sum;
      }, 0);
    const overAllocation = Math.max(monthAllocated - Math.max(monthIncome - monthExpenses, 0), 0);

    return {
      monthIncome,
      monthExpenses,
      monthAllocated,
      categoryOverages,
      overAllocation,
    };
  }

  function firstFutureNegativeBalance(
    nextTransactions: Transaction[],
    nextContributions: SavingsContribution[],
    changedMonthKey: string,
  ) {
    const monthCandidates = new Set<string>();
    categories.forEach((category) => monthCandidates.add(category.monthKey));
    nextTransactions.forEach((transaction) => monthCandidates.add(monthFromDate(transaction.date)));
    nextContributions.forEach((contribution) => monthCandidates.add(monthFromDate(contribution.date)));
    monthCandidates.add(selectedMonthKey);
    monthCandidates.add(changedMonthKey);

    const sortedMonths = Array.from(monthCandidates).sort(compareMonthKeys);
    const monthNetCents = new Map<string, number>();

    nextTransactions.forEach((transaction) => {
      const key = monthFromDate(transaction.date);
      const delta = transaction.type === "income" ? toCents(transaction.amount) : -toCents(transaction.amount);
      monthNetCents.set(key, (monthNetCents.get(key) ?? 0) + delta);
    });

    nextContributions.forEach((contribution) => {
      const key = monthFromDate(contribution.date);
      monthNetCents.set(key, (monthNetCents.get(key) ?? 0) - toCents(contribution.amount));
    });

    let runningCents = 0;
    for (const monthKey of sortedMonths) {
      runningCents += monthNetCents.get(monthKey) ?? 0;
      if (compareMonthKeys(monthKey, changedMonthKey) > 0 && runningCents < 0) {
        return { monthKey, balanceCents: runningCents };
      }
    }

    return null;
  }

  function worsensFutureNegativeBalance(
    nextTransactions: Transaction[],
    nextContributions: SavingsContribution[],
    changedMonthKey: string,
  ) {
    const before = firstFutureNegativeBalance(transactions, contributions, changedMonthKey);
    const after = firstFutureNegativeBalance(nextTransactions, nextContributions, changedMonthKey);
    if (!after) return false;
    if (!before) return true;

    const monthComparison = compareMonthKeys(after.monthKey, before.monthKey);
    if (monthComparison < 0) return true;
    if (monthComparison > 0) return false;
    return after.balanceCents < before.balanceCents;
  }

  function alertFutureNegativeBalance(
    nextTransactions: Transaction[],
    nextContributions: SavingsContribution[],
    changedMonthKey: string,
  ) {
    const nextNegative = firstFutureNegativeBalance(nextTransactions, nextContributions, changedMonthKey);
    if (!nextNegative) return;

    window.alert(
      `This change would make ${formatMonthLabel(nextNegative.monthKey)} go negative (${formatCurrency(
        nextNegative.balanceCents / 100,
      )}). Adjust the amount or add funds first.`,
    );
  }

  const currentMonthDeficitBreakdown = getMonthDeficitBreakdown(
    selectedMonthKey,
    transactions,
    contributions,
  );

  const contributionStatsByGoal = useMemo(() => {
    const stats = new Map<
      number,
      { totalInGoal: number; contributedThisMonth: number; thisMonthEntries: SavingsContribution[] }
    >();

    contributions.forEach((contribution) => {
      const existing = stats.get(contribution.goalId) ?? {
        totalInGoal: 0,
        contributedThisMonth: 0,
        thisMonthEntries: [],
      };

      existing.totalInGoal += contribution.amount;

      if (monthFromDate(contribution.date) === selectedMonthKey) {
        existing.contributedThisMonth += contribution.amount;
        existing.thisMonthEntries.push(contribution);
      }

      stats.set(contribution.goalId, existing);
    });

    return stats;
  }, [contributions, selectedMonthKey]);

  function plannerSummaryForGoal(
    goal: SavingsGoal,
    config: PlannerConfig,
    targetAmountOverride?: number,
  ) {
    const currentSaved = contributionStatsByGoal.get(goal.id)?.totalInGoal ?? 0;
    const targetAmount =
      typeof targetAmountOverride === "number" && Number.isFinite(targetAmountOverride)
        ? Math.max(targetAmountOverride, 0)
        : goal.targetAmount;
    const remainingToTarget = Math.max(targetAmount - currentSaved, 0);

    const targetDate = new Date(config.targetDate);
    const hasValidDate = !Number.isNaN(targetDate.getTime());
    const today = new Date();
    const monthsToGoal = hasValidDate
      ? Math.max(
          (targetDate.getFullYear() - today.getFullYear()) * 12 +
            (targetDate.getMonth() - today.getMonth()) +
            (targetDate.getDate() >= today.getDate() ? 0 : -1),
          0,
        )
      : 0;

    const requiredMonthlyContribution =
      monthsToGoal > 0 ? remainingToTarget / monthsToGoal : remainingToTarget;

    return {
      currentSaved,
      targetAmount,
      remainingToTarget,
      monthsToGoal,
      requiredMonthlyContribution,
    };
  }

  function resetTransactionForm() {
    setTransactionForm({
      description: "",
      amount: "",
      type: "expense",
      category: currentMonthCategories[0]?.name ?? "Food",
      date: `${selectedMonthKey}-01`,
    });
    setEditingTransactionId(null);
    setShowTransactionForm(false);
  }

  function resetCategoryForm() {
    setCategoryForm({ name: "", budgeted: "", rolloverMode: "to_unallocated", icon: "auto" });
    setEditingCategoryId(null);
    setShowCategoryForm(false);
  }

  function resetGoalForm() {
    setGoalForm({ name: "", targetAmount: "" });
    setEditingGoalId(null);
    setShowGoalForm(false);
  }

  function resetContributionForm() {
    setContributionForm({ amount: "", date: `${selectedMonthKey}-01`, note: "" });
    setSelectedGoalId(null);
    setEditingContributionId(null);
    setShowContributionForm(false);
  }

  function handleResetMonth() {
    const confirmed = window.confirm(
      `Reset ${formatMonthLabel(selectedMonthKey)}? This will delete that month's categories, projected income, transactions, and savings contributions.`,
    );
    if (!confirmed) return;

    const monthToDelete = selectedMonthKey;

    setShowTransactionForm(false);
    setShowCategoryForm(false);
    setShowGoalForm(false);
    setShowContributionForm(false);
    setEditingTransactionId(null);
    setEditingCategoryId(null);
    setEditingGoalId(null);
    setEditingContributionId(null);
    setSelectedGoalId(null);
    setInlineEditingTransactionId(null);
    setInlineEditingCategoryId(null);
    setInlineEditingGoalId(null);
    setInlineEditingContributionId(null);

    setPendingResetMonth(monthToDelete);
    setSelectedMonthKey(shiftMonth(monthToDelete, -1));
  }

  function handleAdvanceMonth() {
    const monthToClose = selectedMonthKey;
    const nextMonthKey = shiftMonth(monthToClose, 1);
    let workingContributions = contributions;

    while (true) {
      const runningDeficitCents = Math.max(
        -getUnallocatedCentsThroughMonth(monthToClose, transactions, workingContributions),
        0,
      );

      if (runningDeficitCents <= 0) {
        if (workingContributions !== contributions) setContributions(workingContributions);
        setSelectedMonthKey(nextMonthKey);
        return;
      }

      const breakdown = getMonthDeficitBreakdown(monthToClose, transactions, workingContributions);
      const choice = window.prompt(
          `Cannot close ${formatMonthLabel(monthToClose)} yet.\n` +
          `Running deficit by month end: ${formatCurrency(runningDeficitCents / 100)}\n` +
          `Deficit source in ${formatMonthLabel(monthToClose)}:\n` +
          `- Category overages: ${formatCurrency(breakdown.categoryOverages)}\n` +
          `- Over-allocation to goals: ${formatCurrency(breakdown.overAllocation)}\n\n` +
          `Pick an option:\n` +
          `1 = Pull from Emergency Fund\n` +
          `2 = Reduce this month's goal contributions\n` +
          `3 = Carry deficit into next month`,
        "1",
      );

      if (choice === null) return;

      const trimmedChoice = choice.trim();
      if (trimmedChoice === "3") {
        if (workingContributions !== contributions) setContributions(workingContributions);
        setSelectedMonthKey(nextMonthKey);
        return;
      }

      if (trimmedChoice === "1") {
        const emergencyGoal = goals.find(
          (goal) => goal.name.trim().toLowerCase() === "emergency fund",
        );
        if (!emergencyGoal) {
          window.alert("No Emergency Fund goal found. Create one or choose a different close option.");
          continue;
        }

        const emergencyBalanceCents = workingContributions.reduce((running, contribution) => {
          if (contribution.goalId !== emergencyGoal.id) return running;
          if (compareMonthKeys(monthFromDate(contribution.date), monthToClose) > 0) return running;
          return running + toCents(contribution.amount);
        }, 0);

        const emergencyCoverageCents = Math.min(
          Math.max(emergencyBalanceCents, 0),
          runningDeficitCents,
        );
        if (emergencyCoverageCents <= 0) {
          window.alert(
            "Emergency Fund has no available balance to cover this deficit. Choose a different close option.",
          );
          continue;
        }

        const nextContributionId =
          workingContributions.reduce(
            (maxId, contribution) => Math.max(maxId, contribution.id),
            0,
          ) + 1;

        workingContributions = [
          {
            id: nextContributionId,
            goalId: emergencyGoal.id,
            amount: -(emergencyCoverageCents / 100),
            date: monthEndDate(monthToClose),
            note: `Month close deficit coverage for ${formatMonthLabel(monthToClose)}`,
          },
          ...workingContributions,
        ];
        continue;
      }

      if (trimmedChoice === "2") {
        const contributionCandidates = workingContributions
          .map((contribution, index) => ({ contribution, index }))
          .filter(
            ({ contribution }) =>
              monthFromDate(contribution.date) === monthToClose && contribution.amount > 0,
          )
          .sort((a, b) => {
            if (a.contribution.date !== b.contribution.date) {
              return b.contribution.date.localeCompare(a.contribution.date);
            }
            return b.contribution.id - a.contribution.id;
          });

        if (contributionCandidates.length === 0) {
          window.alert(
            "No positive goal contributions exist in this month to reduce. Choose a different close option.",
          );
          continue;
        }

        let remainingToCoverCents = runningDeficitCents;
        const reducedContributions = [...workingContributions];

        for (const { contribution, index } of contributionCandidates) {
          if (remainingToCoverCents <= 0) break;
          const currentAmountCents = toCents(contribution.amount);
          const reductionCents = Math.min(currentAmountCents, remainingToCoverCents);
          const nextAmountCents = currentAmountCents - reductionCents;
          remainingToCoverCents -= reductionCents;

          reducedContributions[index] = {
            ...contribution,
            amount: nextAmountCents / 100,
          };
        }

        workingContributions = reducedContributions.filter(
          (contribution) => toCents(contribution.amount) !== 0,
        );
        continue;
      }

      window.alert("Choose 1, 2, or 3.");
    }
  }

  function handleAddTransaction() {
    const amount = Number(transactionForm.amount);
    if (!transactionForm.description || !amount || amount <= 0) return;
    const normalizedAmount = toCents(amount) / 100;

    if (editingTransactionId !== null) {
      const originalTransaction = transactions.find(
        (transaction) => transaction.id === editingTransactionId,
      );
      if (!originalTransaction) return;

      const originalMonthKey = monthFromDate(originalTransaction.date);
      const updatedMonthKey = monthFromDate(transactionForm.date);
      const validationMonthKey =
        compareMonthKeys(originalMonthKey, updatedMonthKey) <= 0 ? originalMonthKey : updatedMonthKey;

      const nextTransactions = transactions.map((transaction) =>
        transaction.id === editingTransactionId
          ? {
              ...transaction,
              description: transactionForm.description,
              amount: normalizedAmount,
              type: transactionForm.type,
              category: transactionForm.type === "income" ? "Income" : transactionForm.category,
              date: transactionForm.date,
            }
          : transaction,
      );

      if (worsensFutureNegativeBalance(nextTransactions, contributions, validationMonthKey)) {
        alertFutureNegativeBalance(nextTransactions, contributions, validationMonthKey);
        return;
      }

      setTransactions(nextTransactions);
      resetTransactionForm();
      return;
    }

    const nextTransactions = [
      {
        id: Date.now(),
        description: transactionForm.description,
        amount: normalizedAmount,
        type: transactionForm.type,
        category: transactionForm.type === "income" ? "Income" : transactionForm.category,
        date: transactionForm.date,
      },
      ...transactions,
    ];
    const changedMonthKey = monthFromDate(transactionForm.date);

    if (worsensFutureNegativeBalance(nextTransactions, contributions, changedMonthKey)) {
      alertFutureNegativeBalance(nextTransactions, contributions, changedMonthKey);
      return;
    }

    setTransactions(nextTransactions);

    resetTransactionForm();
  }

  function cancelInlineTransactionEdit() {
    setInlineEditingTransactionId(null);
    setInlineTransactionDraft({
      description: "",
      amount: "",
      type: "expense",
      category: currentMonthCategories[0]?.name ?? "Food",
      date: `${selectedMonthKey}-01`,
    });
  }

  function handleSaveInlineTransaction() {
    if (inlineEditingTransactionId === null) return;

    const amount = Number(inlineTransactionDraft.amount);
    if (!inlineTransactionDraft.description || !amount || amount <= 0) return;
    const normalizedAmount = toCents(amount) / 100;

    const originalTransaction = transactions.find(
      (transaction) => transaction.id === inlineEditingTransactionId,
    );
    if (!originalTransaction) return;

    const originalMonthKey = monthFromDate(originalTransaction.date);
    const updatedMonthKey = monthFromDate(inlineTransactionDraft.date);
    const validationMonthKey =
      compareMonthKeys(originalMonthKey, updatedMonthKey) <= 0 ? originalMonthKey : updatedMonthKey;

    const nextTransactions = transactions.map((transaction) =>
      transaction.id === inlineEditingTransactionId
        ? {
            ...transaction,
            description: inlineTransactionDraft.description,
            amount: normalizedAmount,
            type: inlineTransactionDraft.type,
            category: inlineTransactionDraft.type === "income" ? "Income" : inlineTransactionDraft.category,
            date: inlineTransactionDraft.date,
          }
        : transaction,
    );

    if (worsensFutureNegativeBalance(nextTransactions, contributions, validationMonthKey)) {
      alertFutureNegativeBalance(nextTransactions, contributions, validationMonthKey);
      return;
    }

    setTransactions(nextTransactions);
    cancelInlineTransactionEdit();
  }

  function handleInlineTransactionKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveInlineTransaction();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineTransactionEdit();
    }
  }

  function startInlineCategoryEdit(category: Category) {
    setInlineEditingCategoryId(category.id);
    setInlineCategoryDraft({
      name: category.name,
      budgeted: String(category.baseBudgeted),
      rolloverMode: category.rolloverMode,
      icon: category.icon,
    });
  }

  function cancelInlineCategoryEdit() {
    setInlineEditingCategoryId(null);
    setInlineCategoryDraft({
      name: "",
      budgeted: "",
      rolloverMode: "to_unallocated",
      icon: "auto",
    });
  }

  function handleSaveInlineCategory() {
    if (inlineEditingCategoryId === null) return;

    const budgeted = Number(inlineCategoryDraft.budgeted);
    if (!inlineCategoryDraft.name || !budgeted || budgeted <= 0) return;

    const previousCategory = categories.find((category) => category.id === inlineEditingCategoryId);
    if (!previousCategory) return;

    setCategories((current) =>
      current.map((category) =>
        category.id === inlineEditingCategoryId
          ? {
              ...category,
              name: inlineCategoryDraft.name,
              budgeted,
              baseBudgeted: budgeted,
              rolloverMode: inlineCategoryDraft.rolloverMode,
              icon: resolveCategoryIcon(inlineCategoryDraft.icon, inlineCategoryDraft.name),
            }
          : category,
      ),
    );

    if (previousCategory.name !== inlineCategoryDraft.name) {
      setTransactions((current) =>
        current.map((transaction) =>
          transaction.category === previousCategory.name &&
          monthFromDate(transaction.date) === previousCategory.monthKey
            ? { ...transaction, category: inlineCategoryDraft.name }
            : transaction,
        ),
      );
    }

    cancelInlineCategoryEdit();
  }

  function handleInlineCategoryKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveInlineCategory();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineCategoryEdit();
    }
  }

  function startInlineGoalEdit(goal: SavingsGoal) {
    setInlineEditingGoalId(goal.id);
    setInlineGoalDraft({ name: goal.name, targetAmount: String(goal.targetAmount) });
  }

  function cancelInlineGoalEdit() {
    setInlineEditingGoalId(null);
    setInlineGoalDraft({ name: "", targetAmount: "" });
  }

  function handleSaveInlineGoal() {
    if (inlineEditingGoalId === null) return;

    const targetAmount = Number(inlineGoalDraft.targetAmount);
    if (!inlineGoalDraft.name || !targetAmount || targetAmount <= 0) return;

    setGoals((current) =>
      current.map((goal) =>
        goal.id === inlineEditingGoalId
          ? { ...goal, name: inlineGoalDraft.name, targetAmount: toCents(targetAmount) / 100 }
          : goal,
      ),
    );
    cancelInlineGoalEdit();
  }

  function handleInlineGoalKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveInlineGoal();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineGoalEdit();
    }
  }

  function startInlineContributionEdit(contribution: SavingsContribution) {
    setInlineEditingContributionId(contribution.id);
    setInlineContributionDraft({
      amount: String(contribution.amount),
      date: contribution.date,
      note: contribution.note,
    });
  }

  function cancelInlineContributionEdit() {
    setInlineEditingContributionId(null);
    setInlineContributionDraft({ amount: "", date: `${selectedMonthKey}-01`, note: "" });
  }

  function handleSaveInlineContribution() {
    if (inlineEditingContributionId === null) return;

    const amount = Number(inlineContributionDraft.amount);
    if (!amount || amount <= 0) return;

    const originalContribution = contributions.find(
      (contribution) => contribution.id === inlineEditingContributionId,
    );
    if (!originalContribution) return;

    const contributionMonthKey = monthFromDate(inlineContributionDraft.date);
    const availableToAllocate =
      transactions.reduce((running, transaction) => {
        if (compareMonthKeys(monthFromDate(transaction.date), contributionMonthKey) > 0) return running;
        return running + (transaction.type === "income" ? transaction.amount : -transaction.amount);
      }, 0) -
      contributions.reduce((running, contribution) => {
        if (contribution.id === inlineEditingContributionId) return running;
        if (compareMonthKeys(monthFromDate(contribution.date), contributionMonthKey) > 0) return running;
        return running + contribution.amount;
      }, 0);

    const allocatableCents = toCents(Math.max(availableToAllocate, 0));
    const amountCents = toCents(amount);
    if (amountCents > allocatableCents) {
      window.alert(`You only have ${formatCurrency(allocatableCents / 100)} in unallocated savings available.`);
      return;
    }

    const originalMonthKey = monthFromDate(originalContribution.date);
    const validationMonthKey =
      compareMonthKeys(originalMonthKey, contributionMonthKey) <= 0
        ? originalMonthKey
        : contributionMonthKey;

    const nextContributions = contributions.map((contribution) =>
      contribution.id === inlineEditingContributionId
        ? {
            ...contribution,
            amount: amountCents / 100,
            date: inlineContributionDraft.date,
            note: inlineContributionDraft.note,
          }
        : contribution,
    );

    if (worsensFutureNegativeBalance(transactions, nextContributions, validationMonthKey)) {
      alertFutureNegativeBalance(transactions, nextContributions, validationMonthKey);
      return;
    }

    setContributions(nextContributions);
    cancelInlineContributionEdit();
  }

  function handleInlineContributionKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveInlineContribution();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineContributionEdit();
    }
  }

  function handleAddCategory() {
    const budgeted = Number(categoryForm.budgeted);
    if (!categoryForm.name || !budgeted || budgeted <= 0) return;

    if (editingCategoryId !== null) {
      const previousCategory = categories.find((category) => category.id === editingCategoryId);
      setCategories((current) =>
        current.map((category) =>
          category.id === editingCategoryId
            ? {
                ...category,
                name: categoryForm.name,
                budgeted,
                baseBudgeted: budgeted,
                rolloverMode: categoryForm.rolloverMode,
                icon: resolveCategoryIcon(categoryForm.icon, categoryForm.name),
              }
            : category,
        ),
      );

      if (previousCategory && previousCategory.name !== categoryForm.name) {
        setTransactions((current) =>
          current.map((transaction) =>
            transaction.category === previousCategory.name && monthFromDate(transaction.date) === previousCategory.monthKey
              ? { ...transaction, category: categoryForm.name }
              : transaction,
          ),
        );
      }

      resetCategoryForm();
      return;
    }

    setCategories((current) => [
      ...current,
      {
        id: nextCategoryId(current),
        name: categoryForm.name,
        budgeted,
        baseBudgeted: budgeted,
        monthKey: selectedMonthKey,
        rolloverMode: categoryForm.rolloverMode,
        icon: resolveCategoryIcon(categoryForm.icon, categoryForm.name),
      },
    ]);
    resetCategoryForm();
  }

  function setProjectedIncomeTotalForMonth(total: number) {
    setProjectedIncomeByMonth((current) => ({
      ...current,
      [selectedMonthKey]: total,
    }));
  }

  function handleQuickEditProjectedIncomeTotal() {
    const entered = window.prompt(
      `Set projected income total for ${formatMonthLabel(selectedMonthKey)}:`,
      projectedIncome.toFixed(2),
    );
    if (entered === null) return;

    const parsed = Number(entered);
    if (!Number.isFinite(parsed) || parsed < 0) {
      window.alert("Enter a valid projected income amount (0 or greater).");
      return;
    }

    setProjectedIncomeTotalForMonth(Math.round(parsed * 100) / 100);
  }

  function handleAddGoal() {
    const targetAmount = Number(goalForm.targetAmount);
    if (!goalForm.name || !targetAmount || targetAmount <= 0) return;

    if (editingGoalId !== null) {
      setGoals((current) =>
        current.map((goal) =>
          goal.id === editingGoalId ? { ...goal, name: goalForm.name, targetAmount } : goal,
        ),
      );
      resetGoalForm();
      return;
    }

    setGoals((current) => [...current, { id: Date.now(), name: goalForm.name, targetAmount }]);
    resetGoalForm();
  }

  function handleAddContribution() {
    const amount = Number(contributionForm.amount);
    if (!selectedGoalId || !amount || amount <= 0) return;

    const contributionMonthKey = monthFromDate(contributionForm.date);

    const availableToAllocate = transactions.reduce((running, transaction) => {
      if (compareMonthKeys(monthFromDate(transaction.date), contributionMonthKey) > 0) return running;
      return running + (transaction.type === "income" ? transaction.amount : -transaction.amount);
    }, 0) - contributions.reduce((running, contribution) => {
      if (contribution.id === editingContributionId) return running;
      if (compareMonthKeys(monthFromDate(contribution.date), contributionMonthKey) > 0) return running;
      return running + contribution.amount;
    }, 0);

    const allocatableAmount = Math.max(availableToAllocate, 0);
    const allocatableCents = toCents(allocatableAmount);
    const amountCents = toCents(amount);

    if (amountCents > allocatableCents) {
      window.alert(`You only have ${formatCurrency(allocatableAmount)} in unallocated savings available.`);
      return;
    }

    const normalizedAmount = amountCents / 100;

    if (editingContributionId !== null) {
      const originalContribution = contributions.find(
        (contribution) => contribution.id === editingContributionId,
      );
      if (!originalContribution) return;

      const originalMonthKey = monthFromDate(originalContribution.date);
      const validationMonthKey =
        compareMonthKeys(originalMonthKey, contributionMonthKey) <= 0
          ? originalMonthKey
          : contributionMonthKey;

      const nextContributions = contributions.map((contribution) =>
        contribution.id === editingContributionId
          ? {
              ...contribution,
              goalId: selectedGoalId,
              amount: normalizedAmount,
              date: contributionForm.date,
              note: contributionForm.note,
            }
          : contribution,
      );

      if (worsensFutureNegativeBalance(transactions, nextContributions, validationMonthKey)) {
        alertFutureNegativeBalance(transactions, nextContributions, validationMonthKey);
        return;
      }

      setContributions(nextContributions);
      resetContributionForm();
      return;
    }

    const nextContributions = [
      { id: Date.now(), goalId: selectedGoalId, amount: normalizedAmount, date: contributionForm.date, note: contributionForm.note },
      ...contributions,
    ];

    if (worsensFutureNegativeBalance(transactions, nextContributions, contributionMonthKey)) {
      alertFutureNegativeBalance(transactions, nextContributions, contributionMonthKey);
      return;
    }

    setContributions(nextContributions);
    resetContributionForm();
  }

  function handleEditTransaction(transaction: Transaction) {
    setShowTransactionForm(false);
    setEditingTransactionId(null);
    setInlineEditingTransactionId(transaction.id);
    setInlineTransactionDraft({
      description: transaction.description,
      amount: String(transaction.amount),
      type: transaction.type,
      category: transaction.type === "income" ? currentMonthCategories[0]?.name ?? "Food" : transaction.category,
      date: transaction.date,
    });
  }

  function handleDeleteTransaction(transactionId: number) {
    const transactionToDelete = transactions.find((transaction) => transaction.id === transactionId);
    if (!transactionToDelete) return;

    const nextTransactions = transactions.filter((transaction) => transaction.id !== transactionId);
    const changedMonthKey = monthFromDate(transactionToDelete.date);
    if (worsensFutureNegativeBalance(nextTransactions, contributions, changedMonthKey)) {
      alertFutureNegativeBalance(nextTransactions, contributions, changedMonthKey);
      return;
    }

    if (editingTransactionId === transactionId) resetTransactionForm();
    if (inlineEditingTransactionId === transactionId) cancelInlineTransactionEdit();
    setTransactions(nextTransactions);
  }

  function handleEditCategory(category: Category) {
    setShowCategoryForm(false);
    setEditingCategoryId(null);
    startInlineCategoryEdit(category);
  }

  function handleDeleteCategory(categoryId: number) {
    const categoryToDelete = categories.find((category) => category.id === categoryId);
    if (!categoryToDelete) return;
    if (editingCategoryId === categoryId) resetCategoryForm();
    if (inlineEditingCategoryId === categoryId) cancelInlineCategoryEdit();
    setCategories((current) => current.filter((category) => category.id !== categoryId));
    setTransactions((current) =>
      current.filter(
        (transaction) =>
          !(transaction.category === categoryToDelete.name && monthFromDate(transaction.date) === categoryToDelete.monthKey),
        ),
    );
  }

  function handleCategoryDragStart(categoryId: number) {
    setDraggingCategoryId(categoryId);
    setCategoryDropTargetId(categoryId);
  }

  function handleCategoryDrop(overCategoryId: number) {
    if (draggingCategoryId === null || draggingCategoryId === overCategoryId) {
      setDraggingCategoryId(null);
      setCategoryDropTargetId(null);
      return;
    }

    const draggedCategory = categories.find((category) => category.id === draggingCategoryId);
    const overCategory = categories.find((category) => category.id === overCategoryId);
    if (!draggedCategory || !overCategory || draggedCategory.monthKey !== overCategory.monthKey) {
      setDraggingCategoryId(null);
      setCategoryDropTargetId(null);
      return;
    }

    setCategories((current) =>
      reorderSubsetByIds(
        current,
        (category) => category.monthKey === draggedCategory.monthKey,
        draggingCategoryId,
        overCategoryId,
      ),
    );
    setDraggingCategoryId(null);
    setCategoryDropTargetId(null);
  }

  function resetCategoryDragState() {
    setDraggingCategoryId(null);
    setCategoryDropTargetId(null);
  }

  function handleEditContribution(contribution: SavingsContribution) {
    setShowContributionForm(false);
    setSelectedGoalId(null);
    setEditingContributionId(null);
    startInlineContributionEdit(contribution);
  }

  function handleDeleteContribution(contributionId: number) {
    const contributionToDelete = contributions.find((contribution) => contribution.id === contributionId);
    if (!contributionToDelete) return;

    const nextContributions = contributions.filter((contribution) => contribution.id !== contributionId);
    const changedMonthKey = monthFromDate(contributionToDelete.date);
    if (worsensFutureNegativeBalance(transactions, nextContributions, changedMonthKey)) {
      alertFutureNegativeBalance(transactions, nextContributions, changedMonthKey);
      return;
    }

    if (editingContributionId === contributionId) resetContributionForm();
    if (inlineEditingContributionId === contributionId) cancelInlineContributionEdit();
    setContributions(nextContributions);
  }

  function handleEditGoal(goal: SavingsGoal) {
    setShowGoalForm(false);
    setEditingGoalId(null);
    startInlineGoalEdit(goal);
  }

  function handleDeleteGoal(goalId: number) {
    if (editingGoalId === goalId) resetGoalForm();
    if (inlineEditingGoalId === goalId) cancelInlineGoalEdit();
    if (
      inlineEditingContributionId !== null &&
      contributions.some(
        (contribution) =>
          contribution.id === inlineEditingContributionId && contribution.goalId === goalId,
      )
    ) {
      cancelInlineContributionEdit();
    }
    setGoals((current) => current.filter((goal) => goal.id !== goalId));
    setContributions((current) => current.filter((contribution) => contribution.goalId !== goalId));
  }

  function handleGoalDragStart(goalId: number) {
    setDraggingGoalId(goalId);
    setGoalDropTargetId(goalId);
  }

  function handleGoalDrop(overGoalId: number) {
    if (draggingGoalId === null || draggingGoalId === overGoalId) {
      setDraggingGoalId(null);
      setGoalDropTargetId(null);
      return;
    }

    setGoals((current) => reorderIds(current, draggingGoalId, overGoalId));
    setDraggingGoalId(null);
    setGoalDropTargetId(null);
  }

  function resetGoalDragState() {
    setDraggingGoalId(null);
    setGoalDropTargetId(null);
  }

  function handleApplyQuickTemplate(templateId: PlannerTemplateId) {
    if (goals.length === 0) return;

    const fallbackGoalId = goals[0]?.id;
    const targetGoalId =
      plannerExpandedGoalId !== null && goals.some((goal) => goal.id === plannerExpandedGoalId)
        ? plannerExpandedGoalId
        : fallbackGoalId;

    if (targetGoalId === undefined) return;

    const existingConfig = plannerConfigs[targetGoalId];
    const targetGoalCurrentSaved = contributionStatsByGoal.get(targetGoalId)?.totalInGoal ?? 0;
    const baseConfig: PlannerConfig =
      existingConfig ?? {
        targetDate: "",
        allocations: [
          { symbol: "SPY", percent: "70", dollars: "0" },
          { symbol: "VEA", percent: "30", dollars: "0" },
        ],
        planMode: "confidence",
        monthlyContribution: "300",
        targetConfidence: "70",
        trackingMode: "market",
        fixedApr: "4.0",
        isRetirementAccount: false,
        retirementAnnualSpendGoal: "60000",
        safeWithdrawalRate: "4.0",
        retirementTargetMode: "swr",
        expectedRealReturn: "3.0",
        taxHouseholdIncome: "140000",
        taxFilingStatus: "married_joint",
        taxStateCode: "TX",
        taxAccountType: "traditional_401k",
        taxableWithdrawalGoal: String(goals.find((goal) => goal.id === targetGoalId)?.targetAmount ?? 0),
        taxableCostBasisPercent: "75",
        costBasisMode: "auto",
        benchmarkSymbol: "SPY",
        riskFreeRate: "2.0",
      };

    setPlannerConfigs((current) => ({
      ...current,
      [targetGoalId]: applyPlannerTemplate(baseConfig, templateId, targetGoalCurrentSaved),
    }));
    setPlannerReturnLookbackByGoal((current) => ({
      ...current,
      [targetGoalId]:
        templateId === "emergency_fund_hysa"
          ? "2Y"
          : templateId === "education_529"
            ? "3Y"
            : "5Y",
    }));
  }

  function handleAddInsightAccount() {
    const name = insightAccountForm.name.trim();
    const balance = Number(insightAccountForm.balance);
    if (name.length === 0 || !Number.isFinite(balance)) return;
    setInsightAccounts((current) => [
      ...current,
      {
        id: Date.now(),
        name,
        type: insightAccountForm.type,
        balance,
      },
    ]);
    setInsightAccountForm({ name: "", type: "asset", balance: "" });
    setShowInsightAccountForm(false);
  }

  function handleDeleteInsightAccount(accountId: number) {
    setInsightAccounts((current) => current.filter((account) => account.id !== accountId));
  }

  function handleResetMortgageDefaults() {
    setMortgageForm(defaultMortgageForm);
  }
  function handleResetRentVsBuyDefaults() {
    setRentVsBuyForm(defaultRentVsBuyForm);
  }
  function handleResetPaydownVsInvestDefaults() {
    setPaydownVsInvestForm(defaultPaydownVsInvestForm);
  }

  function shouldSkipPlaidTransaction(tx: PlaidSyncedTransactionPreview) {
    if (!plaidAutoFilterEnabled) return false;
    if (tx.pending) return true;
    const normalized = `${tx.merchantName ?? ""} ${tx.name}`.toLowerCase();
    return /(internal transfer|online transfer|credit card payment|payment thank you|zelle transfer|venmo transfer)/.test(
      normalized,
    );
  }

  function normalizeTransactionText(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(debit|card|purchase|pos|online|ach)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function suggestedCategoryForPlaidExpense(
    tx: PlaidSyncedTransactionPreview,
    learnedCategoryByMerchantKey: Map<string, string>,
  ) {
    const monthKey = monthFromDate(tx.date);
    const monthCategories = categories.filter((category) => category.monthKey === monthKey);
    if (monthCategories.length === 0) return "Uncategorized";
    const normalized = normalizeTransactionText(`${tx.merchantName ?? ""} ${tx.name}`);

    const directMatch = monthCategories.find((category) => {
      const categoryName = normalizeTransactionText(category.name);
      return (
        categoryName.length >= 3 &&
        (normalized.includes(categoryName) || categoryName.includes(normalized))
      );
    });
    if (directMatch) return directMatch.name;

    const learnedCategory = learnedCategoryByMerchantKey.get(normalized);
    if (learnedCategory && monthCategories.some((category) => category.name === learnedCategory)) {
      return learnedCategory;
    }

    let bestKeywordCategory: string | null = null;
    let bestKeywordScore = 0;
    monthCategories.forEach((category) => {
      let score = 0;
      const normalizedCategoryName = normalizeTransactionText(category.name);
      if (normalizedCategoryName.length >= 3 && normalized.includes(normalizedCategoryName)) {
        score += 3;
      }
      const keywords = CATEGORY_KEYWORDS_BY_ICON[category.icon] ?? [];
      keywords.forEach((keyword) => {
        if (normalized.includes(keyword)) score += 2;
      });
      if (score > bestKeywordScore) {
        bestKeywordScore = score;
        bestKeywordCategory = category.name;
      }
    });
    if (bestKeywordCategory && bestKeywordScore > 0) return bestKeywordCategory;

    const inferredIcon = autoCategoryIconFromName(normalized);
    const iconMatch = monthCategories.find((category) => category.icon === inferredIcon);
    if (iconMatch) return iconMatch.name;
    const otherMatch = monthCategories.find((category) => /other|misc/i.test(category.name));
    return otherMatch?.name ?? "Uncategorized";
  }

  function importPlaidTransactionsIntoBudgetRows(incoming: PlaidSyncedTransactionPreview[]) {
    let imported = 0;
    let updated = 0;
    let filtered = 0;
    let idSeed = Date.now();
    const nextTransactions = [...transactions];
    const indexByPlaidId = new Map<string, number>();
    const merchantVotes = new Map<string, Map<string, number>>();
    nextTransactions.forEach((transaction, index) => {
      if (transaction.plaidTransactionId) {
        indexByPlaidId.set(transaction.plaidTransactionId, index);
      }
      if (transaction.type !== "expense") return;
      if (!transaction.category || transaction.category === "Income") return;
      const key = normalizeTransactionText(transaction.description);
      if (key.length < 3) return;
      const votesForMerchant = merchantVotes.get(key) ?? new Map<string, number>();
      votesForMerchant.set(transaction.category, (votesForMerchant.get(transaction.category) ?? 0) + 1);
      merchantVotes.set(key, votesForMerchant);
    });
    const learnedCategoryByMerchantKey = new Map<string, string>();
    merchantVotes.forEach((votes, key) => {
      const winner = Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (winner) learnedCategoryByMerchantKey.set(key, winner);
    });

    incoming.forEach((tx) => {
      if (shouldSkipPlaidTransaction(tx)) {
        filtered += 1;
        return;
      }

      const type: TransactionType = tx.amount < 0 ? "income" : "expense";
      const amount = Math.abs(tx.amount);
      const description = (tx.merchantName?.trim() || tx.name || "Plaid Transaction").trim();
      const category =
        type === "income"
          ? "Income"
          : suggestedCategoryForPlaidExpense(tx, learnedCategoryByMerchantKey);
      const existingIndex = indexByPlaidId.get(tx.transactionId);

      if (existingIndex !== undefined) {
        const existing = nextTransactions[existingIndex];
        nextTransactions[existingIndex] = {
          ...existing,
          description,
          amount,
          type,
          date: tx.date,
          category:
            existing.category && existing.category !== "Uncategorized"
              ? existing.category
              : category,
          source: "plaid",
          plaidTransactionId: tx.transactionId,
        };
        updated += 1;
        return;
      }

      const created: Transaction = {
        id: idSeed,
        description,
        amount,
        type,
        category,
        date: tx.date,
        source: "plaid",
        plaidTransactionId: tx.transactionId,
      };
      idSeed += 1;
      nextTransactions.unshift(created);
      imported += 1;
    });

    if (imported > 0 || updated > 0) {
      nextTransactions.sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return b.id - a.id;
      });
      setTransactions(nextTransactions);
    }

    return { imported, updated, filtered };
  }

  async function plaidFetch(path: string, init?: RequestInit) {
    const sessionResult = await supabase.auth.getSession();
    const token = sessionResult.data.session?.access_token;
    const headers = new Headers(init?.headers ?? {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(path, { ...init, headers });
  }

  async function handleRefreshPlaidStatus() {
    try {
      const response = await plaidFetch("/api/plaid/status");
      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as PlaidStatus & { error?: string }) : ({} as PlaidStatus & { error?: string });
      const data = parsed as PlaidStatus;
      if (!response.ok) throw new Error(parsed.error ?? "status error");
      setPlaidStatus(data);
      return data;
    } catch {
      setPlaidStatus(null);
      return null;
    }
  }

  async function handleRefreshPlaidTransactions() {
    try {
      const response = await plaidFetch("/api/plaid/transactions");
      const text = await response.text();
      const data = (text ? JSON.parse(text) : {}) as {
        transactions?: PlaidSyncedTransactionPreview[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "transactions error");
      const synced = data.transactions ?? [];
      setPlaidSyncedTransactions(synced);
      importPlaidTransactionsIntoBudgetRows(synced);
    } catch {
      setPlaidSyncedTransactions([]);
    }
  }

  async function ensurePlaidScriptLoaded() {
    if (window.Plaid?.create) return;
    await new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector('script[data-plaid-link="true"]');
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Failed to load Plaid script")), {
          once: true,
        });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      script.async = true;
      script.dataset.plaidLink = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Plaid script"));
      document.head.appendChild(script);
    });
  }

  async function handleConnectBank() {
    setPlaidBusy(true);
    setPlaidMessage(null);
    try {
      const linkTokenResponse = await plaidFetch("/api/plaid/link_token/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_user_id: "budget-app-local-user",
          days_requested: plaidHistoryDaysRequested,
        }),
      });
      const linkTokenText = await linkTokenResponse.text();
      const linkTokenData = (linkTokenText ? JSON.parse(linkTokenText) : {}) as {
        link_token?: string;
        error?: string;
      };
      if (!linkTokenResponse.ok || !linkTokenData.link_token) {
        throw new Error(linkTokenData.error ?? "Unable to create link token");
      }
      await ensurePlaidScriptLoaded();
      const plaid = window.Plaid;
      if (!plaid?.create) throw new Error("Plaid Link SDK did not initialize");

      const handler = plaid.create({
        token: linkTokenData.link_token,
        onSuccess: async (publicToken) => {
          try {
            const exchangeResponse = await plaidFetch("/api/plaid/item/public_token/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ public_token: publicToken }),
            });
            const exchangeText = await exchangeResponse.text();
            const exchangeData = (exchangeText ? JSON.parse(exchangeText) : {}) as {
              item_id?: string;
              error?: string;
            };
            if (!exchangeResponse.ok) {
              throw new Error(exchangeData.error ?? "Could not exchange token");
            }
            setPlaidMessage(`Bank linked successfully (${exchangeData.item_id ?? "item connected"}).`);
            await handleRefreshPlaidStatus();
            await handleRefreshPlaidTransactions();
          } catch (error) {
            setPlaidMessage(error instanceof Error ? error.message : "Failed to finish bank linking.");
          } finally {
            setPlaidBusy(false);
          }
        },
        onExit: (error) => {
          if (error?.error_message) {
            setPlaidMessage(`Plaid exited: ${error.error_message}`);
          }
          setPlaidBusy(false);
        },
      });
      handler.open();
    } catch (error) {
      setPlaidMessage(error instanceof Error ? error.message : "Unable to start Plaid Link.");
      setPlaidBusy(false);
    }
  }

  async function handleSyncPlaidTransactions(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    setPlaidSyncBusy(true);
    if (!silent) setPlaidMessage(null);
    try {
      const response = await plaidFetch("/api/plaid/transactions/sync", {
        method: "POST",
      });
      const text = await response.text();
      const data = (text ? JSON.parse(text) : {}) as {
        count?: number;
        added?: number;
        modified?: number;
        removed?: number;
        transactions?: PlaidSyncedTransactionPreview[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to sync Plaid transactions.");
      }
      const synced = data.transactions ?? [];
      setPlaidSyncedTransactions(synced);
      const importSummary = importPlaidTransactionsIntoBudgetRows(synced);
      if (!silent) {
        setPlaidMessage(
          `Transactions synced. Added ${data.added ?? 0}, modified ${data.modified ?? 0}, removed ${data.removed ?? 0}. Imported ${importSummary.imported}, updated ${importSummary.updated}, filtered ${importSummary.filtered}.`,
        );
      }
      await handleRefreshPlaidStatus();
    } catch (error) {
      if (!silent) {
        setPlaidMessage(error instanceof Error ? error.message : "Failed to sync Plaid transactions.");
      }
    } finally {
      setPlaidSyncBusy(false);
    }
  }

  async function handleRemoveAllSyncedTransactions() {
    setPlaidSyncBusy(true);
    setPlaidMessage(null);
    try {
      const response = await plaidFetch("/api/plaid/transactions/reset", { method: "POST" });
      const text = await response.text();
      const data = (text ? JSON.parse(text) : {}) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to reset synced transactions.");
      }

      setTransactions((current) =>
        current.filter(
          (transaction) => transaction.source !== "plaid" && !transaction.plaidTransactionId,
        ),
      );
      setPlaidSyncedTransactions([]);
      await handleRefreshPlaidStatus();
      setPlaidMessage("All synced Plaid transactions were removed from Budget and sync cache was reset.");
    } catch (error) {
      setPlaidMessage(error instanceof Error ? error.message : "Failed to remove synced transactions.");
    } finally {
      setPlaidSyncBusy(false);
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      return;
    }

    let alive = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        setAuthUser(data.session?.user ?? null);
        setAuthLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setAuthLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (activeView !== "insights") return;
    let cancelled = false;

    async function fetchStatus() {
      try {
        const response = await plaidFetch("/api/plaid/status");
        const text = await response.text();
        const data = (text ? JSON.parse(text) : {}) as PlaidStatus;
        if (!response.ok) return null;
        if (!cancelled) setPlaidStatus(data);
        return data;
      } catch {
        if (!cancelled) setPlaidStatus(null);
        return null;
      }
    }

    async function fetchSyncedPreview() {
      try {
        const response = await plaidFetch("/api/plaid/transactions");
        const text = await response.text();
        const data = (text ? JSON.parse(text) : {}) as { transactions?: PlaidSyncedTransactionPreview[] };
        if (!response.ok) return;
        if (!cancelled) setPlaidSyncedTransactions(data.transactions ?? []);
      } catch {
        if (!cancelled) setPlaidSyncedTransactions([]);
      }
    }

    async function syncSilently() {
      try {
        const response = await plaidFetch("/api/plaid/transactions/sync", { method: "POST" });
        const text = await response.text();
        const data = (text ? JSON.parse(text) : {}) as {
          transactions?: PlaidSyncedTransactionPreview[];
        };
        if (!response.ok) return;
        if (cancelled) return;
        setPlaidSyncedTransactions(data.transactions ?? []);
        await fetchStatus();
      } catch {
        // Silent auto-sync should not surface noisy errors.
      }
    }

    async function runInitialPlaidLoad() {
      const status = await fetchStatus();
      if (cancelled) return;
      await fetchSyncedPreview();
      if (cancelled) return;
      if (status?.configured && status.itemCount > 0) {
        await syncSilently();
      }
    }

    runInitialPlaidLoad();

    const intervalId = window.setInterval(async () => {
      if (cancelled) return;
      const status = await fetchStatus();
      if (cancelled) return;
      if (status?.configured && status.itemCount > 0) {
        await syncSilently();
      }
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeView]);

  async function handleSignIn() {
    if (!isSupabaseConfigured) return;
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthMessage("Enter both email and password.");
      return;
    }

    setAuthBusy(true);
    setAuthMessage(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });
    if (error) {
      setAuthMessage(error.message);
      setAuthBusy(false);
      return;
    }
    setAuthPassword("");
    setAuthBusy(false);
  }

  async function handleSignUp() {
    if (!isSupabaseConfigured) return;
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthMessage("Enter both email and password.");
      return;
    }

    setAuthBusy(true);
    setAuthMessage(null);
    const { error } = await supabase.auth.signUp({
      email: authEmail.trim(),
      password: authPassword,
    });
    if (error) {
      setAuthMessage(error.message);
      setAuthBusy(false);
      return;
    }
    setAuthMessage("Account created. Check your email if confirmation is enabled, then sign in.");
    setAuthPassword("");
    setAuthBusy(false);
  }

  async function handleSignOut() {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
    setAuthMessage("Signed out.");
  }

  if (authLoading) {
    return (
      <div className="min-h-screen p-4 md:p-6">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen p-4 md:p-6">
        <div className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
          <p className="text-xl font-bold text-amber-900">Supabase auth is not configured yet</p>
          <p className="mt-2 text-sm text-amber-800">
            Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in local env and Vercel env vars.
          </p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen p-4 md:p-6">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <img src="/insight-i-mark.png" alt="Insight Financial icon" className="h-10 w-10 rounded-xl object-cover" />
            <p className="text-2xl font-bold text-slate-900">Sign in to Insight Financial</p>
          </div>
          <div className="space-y-3">
            <input
              className="app-input w-full"
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
            />
            <input
              className="app-input w-full"
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button className="app-btn-primary" onClick={() => void handleSignIn()} disabled={authBusy}>
                {authBusy ? "Working..." : "Sign In"}
              </button>
              <button className="app-btn-neutral" onClick={() => void handleSignUp()} disabled={authBusy}>
                Create Account
              </button>
            </div>
            {authMessage ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{authMessage}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="app-panel-strong p-3 md:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center justify-center gap-3 md:justify-start">
              <img
                src="/insight-i-mark.png"
                alt="Insight Financial icon"
                className="h-12 w-12 rounded-xl object-cover md:h-14 md:w-14"
              />
              <img
                src="/insight-wordmark.png"
                alt="Insight Financial"
                className="h-12 w-auto max-w-[360px] rounded-lg object-contain md:h-14 md:max-w-[420px]"
              />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
              <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
                <button
                  className={`app-tab ${
                    activeView === "budget" ? "app-tab-active" : "app-tab-inactive"
                  }`}
                  onClick={() => setActiveView("budget")}
                >
                  Budget
                </button>
                <button
                  className={`app-tab ${
                    activeView === "insights" ? "app-tab-active" : "app-tab-inactive"
                  }`}
                  onClick={() => setActiveView("insights")}
                >
                  Insights
                </button>
                <button
                  className={`app-tab ${
                    activeView === "goal_planning" ? "app-tab-active" : "app-tab-inactive"
                  }`}
                  onClick={() => setActiveView("goal_planning")}
                >
                  Goal Planning
                </button>
              </div>
              <button
                className="app-btn-neutral px-3 py-2 text-xs md:text-sm"
                onClick={() => setIsDarkMode((current) => !current)}
              >
                {isDarkMode ? "Light Mode" : "Dark Mode"}
              </button>
              <button className="app-btn-neutral px-3 py-2 text-xs md:text-sm" onClick={() => void handleSignOut()}>
                Sign Out
              </button>
            </div>
          </div>
        </div>

        <div className={activeView === "budget" ? "space-y-6" : "hidden"}>
        <div className="app-panel p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-xl text-slate-600 shadow-sm transition hover:bg-slate-50"
              onClick={() => setSelectedMonthKey((current) => shiftMonth(current, -1))}
            >
              {"<"}
            </button>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">{formatMonthLabel(selectedMonthKey)}</h1>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-xl text-slate-600 shadow-sm transition hover:bg-slate-50"
              onClick={handleAdvanceMonth}
            >
              {">"}
            </button>
            <button
              className="app-btn-danger"
              onClick={handleResetMonth}
            >
              Reset Month
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="app-btn-neutral"
              onClick={() => {
                setEditingCategoryId(null);
                setCategoryForm({ name: "", budgeted: "", rolloverMode: "to_unallocated", icon: "auto" });
                setShowCategoryForm((current) => !current);
              }}
            >
              + Category
            </button>
            <button
              className="app-btn-primary"
              onClick={() => {
                setEditingTransactionId(null);
                setTransactionForm({
                  description: "",
                  amount: "",
                  type: "expense",
                  category: currentMonthCategories[0]?.name ?? "Food",
                  date: `${selectedMonthKey}-01`,
                });
                setShowTransactionForm((current) => !current);
              }}
            >
              + Transaction
            </button>
            <button
              className="app-btn-primary"
              onClick={() => {
                setEditingGoalId(null);
                setGoalForm({ name: "", targetAmount: "" });
                setShowGoalForm((current) => !current);
              }}
            >
              + Savings Goal
            </button>
          </div>
        </div>
        </div>

        {showCategoryForm && (
          <div className="app-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingCategoryId !== null ? "Edit Category" : "Add Category"}</h2>
              <button className="text-sm text-gray-500" onClick={resetCategoryForm}>Cancel</button>
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <input className="app-input" placeholder="Category name" value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} />
              <input className="app-input" placeholder="Budgeted amount" type="number" value={categoryForm.budgeted} onChange={(event) => setCategoryForm((current) => ({ ...current, budgeted: event.target.value }))} />
              <select className="app-input" value={categoryForm.icon} onChange={(event) => setCategoryForm((current) => ({ ...current, icon: event.target.value as CategoryIconChoice }))}>
                <option value="auto">Auto Icon</option>
                {CATEGORY_ICON_OPTIONS.map((option) => (
                  <option key={`category-form-icon-${option.id}`} value={option.id}>{option.label}</option>
                ))}
              </select>
              <select className="app-input" value={categoryForm.rolloverMode} onChange={(event) => setCategoryForm((current) => ({ ...current, rolloverMode: event.target.value as RolloverMode }))}>
                <option value="to_unallocated">Leftover -&gt; Unallocated</option>
                <option value="to_category">Leftover -&gt; Same Category</option>
              </select>
              <button className="app-btn-primary" onClick={handleAddCategory}>{editingCategoryId !== null ? "Update Category" : "Save Category"}</button>
            </div>
          </div>
        )}

        {showTransactionForm && (
          <div className="app-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingTransactionId !== null ? "Edit Transaction" : "Add Transaction"}</h2>
              <button className="text-sm text-gray-500" onClick={resetTransactionForm}>Cancel</button>
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <input className="app-input" placeholder="Description" value={transactionForm.description} onChange={(event) => setTransactionForm((current) => ({ ...current, description: event.target.value }))} />
              <input className="app-input" placeholder="Amount" type="number" value={transactionForm.amount} onChange={(event) => setTransactionForm((current) => ({ ...current, amount: event.target.value }))} />
              <select className="app-input" value={transactionForm.type} onChange={(event) => setTransactionForm((current) => ({ ...current, type: event.target.value as TransactionType }))}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <select className="app-input disabled:bg-slate-100" value={transactionForm.category} disabled={transactionForm.type === "income"} onChange={(event) => setTransactionForm((current) => ({ ...current, category: event.target.value }))}>
                {currentMonthCategories.map((category) => (
                  <option key={category.id} value={category.name}>{category.name}</option>
                ))}
              </select>
              <input className="app-input" type="date" value={transactionForm.date} onChange={(event) => setTransactionForm((current) => ({ ...current, date: event.target.value }))} />
            </div>
            <div className="mt-3 flex justify-end">
              <button className="app-btn-primary" onClick={handleAddTransaction}>{editingTransactionId !== null ? "Update Transaction" : "Save Transaction"}</button>
            </div>
          </div>
        )}

        {showGoalForm && (
          <div className="app-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingGoalId !== null ? "Edit Savings Goal" : "Add Savings Goal"}</h2>
              <button className="text-sm text-gray-500" onClick={resetGoalForm}>Cancel</button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input className="app-input" placeholder="Goal name" value={goalForm.name} onChange={(event) => setGoalForm((current) => ({ ...current, name: event.target.value }))} />
              <input className="app-input" placeholder="Target amount" type="number" value={goalForm.targetAmount} onChange={(event) => setGoalForm((current) => ({ ...current, targetAmount: event.target.value }))} />
              <button className="app-btn-primary" onClick={handleAddGoal}>{editingGoalId !== null ? "Update Goal" : "Save Goal"}</button>
            </div>
          </div>
        )}

        {showContributionForm && (
          <div className="app-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingContributionId !== null ? "Edit Contribution" : "Add Contribution"}</h2>
              <button className="text-sm text-gray-500" onClick={resetContributionForm}>Cancel</button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <input className="app-input" placeholder="Amount" type="number" value={contributionForm.amount} onChange={(event) => setContributionForm((current) => ({ ...current, amount: event.target.value }))} />
              <input className="app-input" type="date" value={contributionForm.date} onChange={(event) => setContributionForm((current) => ({ ...current, date: event.target.value }))} />
              <input className="app-input" placeholder="Note" value={contributionForm.note} onChange={(event) => setContributionForm((current) => ({ ...current, note: event.target.value }))} />
              <button className="app-btn-primary" onClick={handleAddContribution}>{editingContributionId !== null ? "Update Contribution" : "Save Contribution"}</button>
            </div>
          </div>
        )}

        <div className="app-panel-strong p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Savings Balance</p>
              <p className="mt-1 text-4xl font-bold text-slate-900">{formatCurrency(savingsBalance)}</p>
            </div>
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-600">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 14l4-4 4 4 8-8" />
                <path d="M16 6h4v4" />
              </svg>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="overflow-hidden app-panel">
            <button className="flex w-full items-start justify-between p-5 text-left transition hover:bg-slate-50/70" onClick={handleQuickEditProjectedIncomeTotal}>
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-500">Projected Income</p>
                <p className="text-2xl font-bold text-slate-900">{formatCurrency(projectedIncome)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500 text-white">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3v18" />
                    <path d="M17 7.5A4.5 4.5 0 0 0 12.5 3H11a4 4 0 0 0 0 8h2a4 4 0 0 1 0 8h-2.5A4.5 4.5 0 0 1 6 14.5" />
                  </svg>
                </span>
              </div>
            </button>
          </div>

          <div className="app-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">Projected Expenses</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{formatCurrency(projectedExpenses)}</p>
              </div>
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-white">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 8l6 6 4-4 6 6" />
                  <path d="M20 12v4h-4" />
                </svg>
              </span>
            </div>
          </div>
          <div className="app-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">Income Received</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{formatCurrency(incomeReceived)}</p>
              </div>
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="6" width="18" height="14" rx="2" />
                  <path d="M3 10h18" />
                  <circle cx="16" cy="15" r="1.5" />
                </svg>
              </span>
            </div>
          </div>
          <div className="app-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">Amount Spent</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{formatCurrency(amountSpent)}</p>
              </div>
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500 text-white">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v10" />
                  <path d="M15.5 9.5A3.5 3.5 0 0 0 12.5 8H11a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 1 0 5h-1.5a3.5 3.5 0 0 1-3-1.5" />
                </svg>
              </span>
            </div>
          </div>
          <div className="app-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">Saved This Month</p>
                <p className={`mt-1 text-2xl font-bold ${savedThisMonth < 0 ? "text-red-500" : "text-emerald-600"}`}>{formatCurrency(savedThisMonth)}</p>
              </div>
              <span className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl text-white ${savedThisMonth < 0 ? "bg-red-500" : "bg-emerald-500"}`}>
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 14l4-4 4 4 8-8" />
                  <path d="M16 6h4v4" />
                </svg>
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="app-section-title flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-sm text-amber-700">#</span>
            Budget Categories
          </h2>
          {currentMonthCategories.length === 0 ? (
            <div className="app-panel p-10 text-center">
              <p className="text-lg text-gray-600">No categories for {formatMonthLabel(selectedMonthKey)} yet</p>
              <p className="text-gray-400">Add categories to start organizing this month&apos;s budget. Categories from the previous month will carry over automatically when available.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {currentMonthCategories.map((category) => {
                const spent = spentForCategoryInMonth(category.name, selectedMonthKey);
                const remaining = category.budgeted - spent;
                const rolloverAmount = category.budgeted - category.baseBudgeted;
                const isDragging = draggingCategoryId === category.id;
                const isDropTarget =
                  categoryDropTargetId === category.id && draggingCategoryId !== category.id;
                return (
                  <div
                    key={category.id}
                    draggable={inlineEditingCategoryId !== category.id}
                    onDragStart={() => handleCategoryDragStart(category.id)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (draggingCategoryId !== null && draggingCategoryId !== category.id) {
                        setCategoryDropTargetId(category.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleCategoryDrop(category.id);
                    }}
                    onDragEnd={resetCategoryDragState}
                    className={`group app-panel app-sort-card p-5 ${
                      isDragging ? "app-sort-card-dragging" : "app-sort-card-idle"
                    } ${
                      isDropTarget ? "app-sort-card-target ring-sky-300" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {inlineEditingCategoryId === category.id ? (
                        <div className="w-full space-y-2">
                          <input
                            className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                            value={inlineCategoryDraft.name}
                            onKeyDown={handleInlineCategoryKeyDown}
                            onChange={(event) =>
                              setInlineCategoryDraft((current) => ({ ...current, name: event.target.value }))
                            }
                          />
                          <input
                            className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                            type="number"
                            value={inlineCategoryDraft.budgeted}
                            onKeyDown={handleInlineCategoryKeyDown}
                            onChange={(event) =>
                              setInlineCategoryDraft((current) => ({ ...current, budgeted: event.target.value }))
                            }
                          />
                          <select
                            className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                            value={inlineCategoryDraft.icon}
                            onKeyDown={handleInlineCategoryKeyDown}
                            onChange={(event) =>
                              setInlineCategoryDraft((current) => ({
                                ...current,
                                icon: event.target.value as CategoryIconChoice,
                              }))
                            }
                          >
                            <option value="auto">Auto Icon</option>
                            {CATEGORY_ICON_OPTIONS.map((option) => (
                              <option key={`inline-category-icon-${option.id}`} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                          <select
                            className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                            value={inlineCategoryDraft.rolloverMode}
                            onKeyDown={handleInlineCategoryKeyDown}
                            onChange={(event) =>
                              setInlineCategoryDraft((current) => ({
                                ...current,
                                rolloverMode: event.target.value as RolloverMode,
                              }))
                            }
                          >
                            <option value="to_unallocated">Leftover -&gt; Unallocated</option>
                            <option value="to_category">Leftover -&gt; Same Category</option>
                          </select>
                          <div className="flex items-center gap-2">
                            <button className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white" onClick={handleSaveInlineCategory}>Save</button>
                            <button className="rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700" onClick={cancelInlineCategoryEdit}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="app-sort-handle cursor-grab active:cursor-grabbing">
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M9 6h.01" strokeLinecap="round" />
                                  <path d="M9 12h.01" strokeLinecap="round" />
                                  <path d="M9 18h.01" strokeLinecap="round" />
                                  <path d="M15 6h.01" strokeLinecap="round" />
                                  <path d="M15 12h.01" strokeLinecap="round" />
                                  <path d="M15 18h.01" strokeLinecap="round" />
                                </svg>
                              </span>
                              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${categoryIconBadgeStyle(category.icon)}`}>
                                <CategoryIconGlyph iconId={category.icon} />
                              </span>
                              <h3 className="text-lg font-semibold text-gray-900">{category.name}</h3>
                            </div>
                            <p className="text-sm text-gray-500">Budgeted {formatCurrency(category.budgeted)}</p>
                            <div className="app-reorder-hint">
                              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <path d="M4 7h12" strokeLinecap="round" />
                                <path d="M4 10h12" strokeLinecap="round" />
                                <path d="M4 13h12" strokeLinecap="round" />
                              </svg>
                              <span>Drag to reorder</span>
                            </div>
                            <p className="mt-1 text-xs text-gray-400">
                              Rollover: {category.rolloverMode === "to_category" ? "Same Category" : "Unallocated"}
                            </p>
                            {category.rolloverMode === "to_category" && rolloverAmount !== 0 ? (
                              <p className={`mt-1 text-xs ${rolloverAmount < 0 ? "text-red-600" : "text-sky-600"}`}>
                                Includes rollover of {formatCurrency(rolloverAmount)}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <button className="rounded-lg bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700" onClick={() => handleEditCategory(category)}>Edit</button>
                            <button className="rounded-lg bg-red-100 px-3 py-1 text-xs font-medium text-red-700" onClick={() => handleDeleteCategory(category.id)}>Delete</button>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-gray-500">Spent</span><span className="font-medium text-gray-900">{formatCurrency(spent)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Remaining</span><span className={`font-medium ${remaining < 0 ? "text-red-500" : "text-green-600"}`}>{formatCurrency(remaining)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="app-section-title flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-sm text-emerald-700">$</span>
              Savings Goals
            </h2>
            <div className="flex gap-3 text-sm">
              <div className="app-chip">Allocated (to date): <span className="font-semibold">{formatCurrency(savingsToDate.allocatedToDate)}</span></div>
              <div className="app-chip">Unallocated: <span className="font-semibold">{formatCurrency(unallocatedSavings)}</span></div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-2xl border border-dashed border-slate-300/80 bg-white/90 p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Unallocated Savings</h3>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">This Month</span><span className="font-medium text-gray-900">{formatCurrency(savedThisMonth)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Available To Date</span><span className="font-medium text-gray-900">{formatCurrency(unallocatedSavings)}</span></div>
              </div>
              {unallocatedSavings < 0 ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <p className="font-semibold">Warning: deficit of {formatCurrency(Math.abs(unallocatedSavings))}</p>
                  <p className="mt-1">Source this month:</p>
                  <p>Category overages: {formatCurrency(currentMonthDeficitBreakdown.categoryOverages)}</p>
                  <p>Over-allocation to goals: {formatCurrency(currentMonthDeficitBreakdown.overAllocation)}</p>
                </div>
              ) : null}
              <p className="mt-4 text-sm text-gray-500">Savings that have not been assigned to a goal yet will carry over here.</p>
            </div>

            {goals.map((goal) => {
              const goalStats = contributionStatsByGoal.get(goal.id);
              const totalInGoal = goalStats?.totalInGoal ?? 0;
              const contributedThisMonth = goalStats?.contributedThisMonth ?? 0;
              const thisMonthContributions = goalStats?.thisMonthEntries ?? [];
              const percent = goal.targetAmount > 0 ? (totalInGoal / goal.targetAmount) * 100 : 0;
              const remaining = Math.max(goal.targetAmount - totalInGoal, 0);
              const isDragging = draggingGoalId === goal.id;
              const isDropTarget = goalDropTargetId === goal.id && draggingGoalId !== goal.id;

              return (
                <div
                  key={goal.id}
                  draggable={inlineEditingGoalId !== goal.id}
                  onDragStart={() => handleGoalDragStart(goal.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggingGoalId !== null && draggingGoalId !== goal.id) {
                      setGoalDropTargetId(goal.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleGoalDrop(goal.id);
                  }}
                  onDragEnd={resetGoalDragState}
                  className={`group app-panel app-sort-card p-5 ${
                    isDragging ? "app-sort-card-dragging" : "app-sort-card-idle"
                  } ${
                    isDropTarget ? "app-sort-card-target ring-emerald-300" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {inlineEditingGoalId === goal.id ? (
                      <div className="w-full space-y-2">
                        <input
                          className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                          value={inlineGoalDraft.name}
                          onKeyDown={handleInlineGoalKeyDown}
                          onChange={(event) =>
                            setInlineGoalDraft((current) => ({ ...current, name: event.target.value }))
                          }
                        />
                        <input
                          className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                          type="number"
                          value={inlineGoalDraft.targetAmount}
                          onKeyDown={handleInlineGoalKeyDown}
                          onChange={(event) =>
                            setInlineGoalDraft((current) => ({
                              ...current,
                              targetAmount: event.target.value,
                            }))
                          }
                        />
                        <div className="flex gap-2">
                          <button className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white" onClick={handleSaveInlineGoal}>Save</button>
                          <button className="rounded-lg bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700" onClick={cancelInlineGoalEdit}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="app-sort-handle cursor-grab active:cursor-grabbing">
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 6h.01" strokeLinecap="round" />
                                <path d="M9 12h.01" strokeLinecap="round" />
                                <path d="M9 18h.01" strokeLinecap="round" />
                                <path d="M15 6h.01" strokeLinecap="round" />
                                <path d="M15 12h.01" strokeLinecap="round" />
                                <path d="M15 18h.01" strokeLinecap="round" />
                              </svg>
                            </span>
                            <h3 className="text-lg font-semibold text-gray-900">{goal.name}</h3>
                          </div>
                          <p className="text-sm text-gray-500">Goal {formatCurrency(goal.targetAmount)}</p>
                          <div className="app-reorder-hint">
                            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M4 7h12" strokeLinecap="round" />
                              <path d="M4 10h12" strokeLinecap="round" />
                              <path d="M4 13h12" strokeLinecap="round" />
                            </svg>
                            <span>Drag to reorder</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700" onClick={() => handleEditGoal(goal)}>Edit</button>
                          <button className="rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700" onClick={() => handleDeleteGoal(goal.id)}>Delete</button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-4">
                    <div className="space-y-3 text-sm">
                      <div><p className="text-gray-500">Contributed This Month</p><p className="text-lg font-semibold text-gray-900">{formatCurrency(contributedThisMonth)}</p></div>
                      <div><p className="text-gray-500">Total In Goal</p><p className="text-lg font-semibold text-gray-900">{formatCurrency(totalInGoal)}</p></div>
                    </div>
                    <CircularProgress percent={percent} />
                  </div>

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="text-gray-500">Remaining to Goal</span>
                    <span className="font-medium text-gray-900">{formatCurrency(remaining)}</span>
                  </div>

                  <button className="mt-5 w-full rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-600 transition hover:bg-gray-50" onClick={() => { setSelectedGoalId(goal.id); setContributionForm({ amount: "", date: `${selectedMonthKey}-01`, note: "" }); setShowContributionForm(true); }}>
                    + Add Contribution
                  </button>

                  <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                    <p className="text-sm font-medium text-gray-700">This Month&apos;s Contributions</p>
                    {thisMonthContributions.length === 0 ? (
                      <p className="text-sm text-gray-500">No contributions this month yet.</p>
                    ) : (
                      thisMonthContributions.map((contribution) => (
                        <div key={contribution.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                          {inlineEditingContributionId === contribution.id ? (
                            <div className="grid w-full gap-2 md:grid-cols-[1fr_1fr_1.5fr_auto] md:items-center">
                              <input
                                className="rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                                type="number"
                                value={inlineContributionDraft.amount}
                                onKeyDown={handleInlineContributionKeyDown}
                                onChange={(event) =>
                                  setInlineContributionDraft((current) => ({
                                    ...current,
                                    amount: event.target.value,
                                  }))
                                }
                              />
                              <input
                                className="rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                                type="date"
                                value={inlineContributionDraft.date}
                                onKeyDown={handleInlineContributionKeyDown}
                                onChange={(event) =>
                                  setInlineContributionDraft((current) => ({
                                    ...current,
                                    date: event.target.value,
                                  }))
                                }
                              />
                              <input
                                className="rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                                value={inlineContributionDraft.note}
                                onKeyDown={handleInlineContributionKeyDown}
                                onChange={(event) =>
                                  setInlineContributionDraft((current) => ({
                                    ...current,
                                    note: event.target.value,
                                  }))
                                }
                              />
                              <div className="flex gap-2">
                                <button className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white" onClick={handleSaveInlineContribution}>Save</button>
                                <button className="rounded-lg bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700" onClick={cancelInlineContributionEdit}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div>
                                <p className="text-sm font-medium text-gray-800">{formatCurrency(contribution.amount)}</p>
                                <p className="text-xs text-gray-500">{contribution.date}{contribution.note ? ` - ${contribution.note}` : ""}</p>
                              </div>
                              <div className="flex gap-2">
                                <button className="rounded-lg bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700" onClick={() => handleEditContribution(contribution)}>Edit</button>
                                <button className="rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700" onClick={() => handleDeleteContribution(contribution.id)}>Delete</button>
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="app-section-title flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sm text-sky-700">T</span>
              Recent Transactions
            </h2>
            <div className="flex items-center gap-2">
              <button
                className="app-btn-neutral px-3 py-1.5 text-xs"
                onClick={() => void handleSyncPlaidTransactions()}
                disabled={plaidSyncBusy || plaidBusy}
              >
                {plaidSyncBusy ? "Syncing..." : "Sync Transactions"}
              </button>
              <button
                className="app-btn-danger px-3 py-1.5 text-xs"
                onClick={() => void handleRemoveAllSyncedTransactions()}
                disabled={plaidSyncBusy || plaidBusy}
              >
                Clear Synced
              </button>
            </div>
          </div>
          {plaidMessage ? (
            <p className="text-xs text-slate-600">{plaidMessage}</p>
          ) : null}
          <div className="overflow-hidden app-panel-strong">
            <div className="grid grid-cols-5 gap-3 border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-500">
              <p>Description</p><p>Category</p><p>Type</p><p>Date</p><p className="text-right">Amount</p>
            </div>
            {currentMonthTransactions.map((transaction) => {
              const isInlineEditing = inlineEditingTransactionId === transaction.id;
              const categoryOptions = Array.from(
                new Set([
                  ...currentMonthCategories.map((category) => category.name),
                  transaction.category,
                  inlineTransactionDraft.category,
                ]),
              ).filter(Boolean);

              if (isInlineEditing) {
                return (
                  <div key={transaction.id} className="grid grid-cols-5 gap-3 border-b border-gray-100 bg-sky-50/40 px-5 py-4 text-sm last:border-b-0">
                    <div>
                      <input
                        className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                        value={inlineTransactionDraft.description}
                        onKeyDown={handleInlineTransactionKeyDown}
                        onChange={(event) =>
                          setInlineTransactionDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                      />
                      <div className="mt-2 flex gap-2">
                        <button className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white" onClick={handleSaveInlineTransaction}>Save</button>
                        <button className="rounded-lg bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700" onClick={cancelInlineTransactionEdit}>Cancel</button>
                      </div>
                    </div>
                    <div>
                      {inlineTransactionDraft.type === "income" ? (
                        <p className="pt-2 text-gray-500">Income</p>
                      ) : (
                        <select
                          className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                          value={inlineTransactionDraft.category}
                          onKeyDown={handleInlineTransactionKeyDown}
                          onChange={(event) =>
                            setInlineTransactionDraft((current) => ({
                              ...current,
                              category: event.target.value,
                            }))
                          }
                        >
                          {categoryOptions.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <select
                        className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                        value={inlineTransactionDraft.type}
                        onKeyDown={handleInlineTransactionKeyDown}
                        onChange={(event) =>
                          setInlineTransactionDraft((current) => ({
                            ...current,
                            type: event.target.value as TransactionType,
                            category:
                              event.target.value === "income"
                                ? "Income"
                                : current.category === "Income"
                                  ? currentMonthCategories[0]?.name ?? "Food"
                                  : current.category,
                          }))
                        }
                      >
                        <option value="expense">expense</option>
                        <option value="income">income</option>
                      </select>
                    </div>
                    <div>
                      <input
                        className="w-full rounded-lg border border-gray-200 px-2 py-1 outline-none focus:border-sky-400"
                        type="date"
                        value={inlineTransactionDraft.date}
                        onKeyDown={handleInlineTransactionKeyDown}
                        onChange={(event) =>
                          setInlineTransactionDraft((current) => ({
                            ...current,
                            date: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <input
                        className="w-full rounded-lg border border-gray-200 px-2 py-1 text-right outline-none focus:border-sky-400"
                        type="number"
                        value={inlineTransactionDraft.amount}
                        onKeyDown={handleInlineTransactionKeyDown}
                        onChange={(event) =>
                          setInlineTransactionDraft((current) => ({
                            ...current,
                            amount: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div key={transaction.id} className="grid grid-cols-5 gap-3 border-b border-gray-100 px-5 py-4 text-sm last:border-b-0">
                  <div>
                    <p className="font-medium text-gray-800">{transaction.description}</p>
                    <div className="mt-2 flex gap-2">
                      <button className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700" onClick={() => handleEditTransaction(transaction)}>Edit</button>
                      <button className="rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700" onClick={() => handleDeleteTransaction(transaction.id)}>Delete</button>
                    </div>
                  </div>
                  <p className="text-gray-500">{transaction.category}</p>
                  <p><span className={`rounded-full px-2 py-1 text-xs font-medium ${transaction.type === "income" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{transaction.type}</span></p>
                  <p className="text-gray-500">{transaction.date}</p>
                  <p className="text-right font-semibold text-gray-800">{formatCurrency(transaction.amount)}</p>
                </div>
              );
            })}
            {currentMonthTransactions.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-500">No transactions for {formatMonthLabel(selectedMonthKey)} yet.</div>
            ) : null}
          </div>
        </div>
        </div>

        {activeView === "insights" && (
          <div className="space-y-5">
            <div className="app-panel-strong p-5">
              <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-100 text-sm text-cyan-700">I</span>
                Insights
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Track net worth, model housing affordability, and prepare for future bank sync.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="app-panel p-5">
                <p className="text-sm font-medium text-slate-500">Total Assets</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{formatCurrency(insightNetWorth.assets)}</p>
              </div>
              <div className="app-panel p-5">
                <p className="text-sm font-medium text-slate-500">Total Liabilities</p>
                <p className="mt-1 text-2xl font-bold text-rose-600">{formatCurrency(insightNetWorth.liabilities)}</p>
              </div>
              <div className="app-panel p-5">
                <p className="text-sm font-medium text-slate-500">Net Worth</p>
                <p className={`mt-1 text-2xl font-bold ${netWorthValue < 0 ? "text-rose-600" : "text-slate-900"}`}>
                  {formatCurrency(netWorthValue)}
                </p>
              </div>
              <div className="app-panel p-5">
                <p className="text-sm font-medium text-slate-500">This Month Savings Rate</p>
                <p className={`mt-1 text-2xl font-bold ${savedThisMonth < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {incomeReceived > 0 ? `${((savedThisMonth / incomeReceived) * 100).toFixed(1)}%` : "0.0%"}
                </p>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="app-panel p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-lg font-semibold text-slate-900">Net Worth Accounts</p>
                    <p className="text-sm text-slate-500">Manual accounts now, ready for bank sync later.</p>
                  </div>
                  <button
                    className="app-btn-neutral"
                    onClick={() => setShowInsightAccountForm((current) => !current)}
                  >
                    {showInsightAccountForm ? "Close" : "+ Account"}
                  </button>
                </div>
                {showInsightAccountForm ? (
                  <div className="mb-4 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
                    <input
                      className="app-input"
                      placeholder="Account name"
                      value={insightAccountForm.name}
                      onChange={(event) =>
                        setInsightAccountForm((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                    <select
                      className="app-input"
                      value={insightAccountForm.type}
                      onChange={(event) =>
                        setInsightAccountForm((current) => ({
                          ...current,
                          type: event.target.value as InsightAccountType,
                        }))
                      }
                    >
                      <option value="asset">Asset</option>
                      <option value="liability">Liability</option>
                    </select>
                    <input
                      className="app-input"
                      type="number"
                      placeholder="Balance"
                      value={insightAccountForm.balance}
                      onChange={(event) =>
                        setInsightAccountForm((current) => ({ ...current, balance: event.target.value }))
                      }
                    />
                    <button className="app-btn-primary" onClick={handleAddInsightAccount}>Save Account</button>
                  </div>
                ) : null}
                <div className="space-y-2">
                  {insightAccounts.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      No accounts yet. Add checking, savings, debt, retirement, or brokerage balances.
                    </p>
                  ) : (
                    insightAccounts.map((account) => (
                      <div key={account.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <div>
                          <p className="font-medium text-slate-900">{account.name}</p>
                          <p className={`text-xs ${account.type === "asset" ? "text-emerald-600" : "text-rose-600"}`}>
                            {account.type === "asset" ? "Asset" : "Liability"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold ${account.type === "asset" ? "text-slate-900" : "text-rose-700"}`}>
                            {formatCurrency(account.balance)}
                          </p>
                          <button
                            className="rounded-lg bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700"
                            onClick={() => handleDeleteInsightAccount(account.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="app-panel p-5">
                <p className="text-lg font-semibold text-slate-900">Net Worth Trend (6 Months)</p>
                <p className="mb-3 text-sm text-slate-500">A quick month-by-month view based on your transaction history and current account snapshot.</p>
                <div className="space-y-2">
                  {netWorthTrend.map((point) => {
                    const maxAbs = Math.max(
                      ...netWorthTrend.map((item) => Math.abs(item.value)),
                      1,
                    );
                    const widthPercent = Math.max((Math.abs(point.value) / maxAbs) * 100, 6);
                    return (
                      <div key={`nw-${point.monthKey}`} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                          <span>{formatMonthLabel(point.monthKey)}</span>
                          <span className={point.value < 0 ? "text-rose-600" : "text-slate-700"}>
                            {formatCurrency(point.value)}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200">
                          <div
                            className={`h-2 rounded-full ${point.value < 0 ? "bg-rose-400" : "bg-sky-500"}`}
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="app-panel p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold text-slate-900">Mortgage Calculator</p>
                  <p className="text-sm text-slate-500">Estimate monthly payment, total interest, and full housing cost stack.</p>
                </div>
                <button className="app-btn-neutral" onClick={handleResetMortgageDefaults}>
                  Reset Defaults
                </button>
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <p className="mb-3 text-sm font-semibold text-slate-800">Inputs</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Home Price</span>
                      <input className="app-input w-full" type="number" value={mortgageForm.homePrice} onChange={(event) => setMortgageForm((current) => ({ ...current, homePrice: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Down Payment</span>
                      <input className="app-input w-full" type="number" value={mortgageForm.downPayment} onChange={(event) => setMortgageForm((current) => ({ ...current, downPayment: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Interest Rate (%)</span>
                      <input className="app-input w-full" type="number" step="0.01" value={mortgageForm.interestRate} onChange={(event) => setMortgageForm((current) => ({ ...current, interestRate: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Term (Years)</span>
                      <input className="app-input w-full" type="number" value={mortgageForm.termYears} onChange={(event) => setMortgageForm((current) => ({ ...current, termYears: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property Tax / Year</span>
                      <input className="app-input w-full" type="number" value={mortgageForm.propertyTaxAnnual} onChange={(event) => setMortgageForm((current) => ({ ...current, propertyTaxAnnual: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Insurance / Year</span>
                      <input className="app-input w-full" type="number" value={mortgageForm.insuranceAnnual} onChange={(event) => setMortgageForm((current) => ({ ...current, insuranceAnnual: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">HOA / Month</span>
                      <input className="app-input w-full" type="number" value={mortgageForm.hoaMonthly} onChange={(event) => setMortgageForm((current) => ({ ...current, hoaMonthly: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">PMI / Month</span>
                      <input className="app-input w-full" type="number" value={mortgageForm.pmiMonthly} onChange={(event) => setMortgageForm((current) => ({ ...current, pmiMonthly: event.target.value }))} />
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-800 via-cyan-700 to-blue-800 p-4 text-white shadow-[0_10px_24px_rgba(2,132,199,0.28)]">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Estimated Total Housing Cost / Month</p>
                    <p className="mt-1 text-3xl font-bold">{formatCurrency(mortgageSummary.monthlyTotal)}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs text-slate-500">Loan Principal</p>
                      <p className="text-lg font-semibold text-slate-900">{formatCurrency(mortgageSummary.principal)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs text-slate-500">Principal + Interest / Month</p>
                      <p className="text-lg font-semibold text-slate-900">{formatCurrency(mortgageSummary.monthlyPI)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:col-span-2">
                      <p className="text-xs text-slate-500">Total Interest Over Loan</p>
                      <p className="text-lg font-semibold text-slate-900">{formatCurrency(mortgageSummary.totalInterest)}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly Breakdown</p>
                    <div className="space-y-1 text-sm text-slate-600">
                      <div className="flex items-center justify-between"><span>Tax</span><span className="font-medium text-slate-800">{formatCurrency(mortgageSummary.monthlyTax)}</span></div>
                      <div className="flex items-center justify-between"><span>Insurance</span><span className="font-medium text-slate-800">{formatCurrency(mortgageSummary.monthlyInsurance)}</span></div>
                      <div className="flex items-center justify-between"><span>HOA</span><span className="font-medium text-slate-800">{formatCurrency(mortgageSummary.hoaMonthly)}</span></div>
                      <div className="flex items-center justify-between"><span>PMI</span><span className="font-medium text-slate-800">{formatCurrency(mortgageSummary.pmiMonthly)}</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="app-panel p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold text-slate-900">Rent vs Buy Calculator</p>
                    <p className="text-sm text-slate-500">Compare ownership cost to renting over a selected horizon.</p>
                  </div>
                  <button className="app-btn-neutral" onClick={handleResetRentVsBuyDefaults}>
                    Reset Defaults
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Home Price</span><input className="app-input w-full" type="number" value={rentVsBuyForm.homePrice} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, homePrice: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Down Payment</span><input className="app-input w-full" type="number" value={rentVsBuyForm.downPayment} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, downPayment: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mortgage Rate (%)</span><input className="app-input w-full" type="number" step="0.01" value={rentVsBuyForm.interestRate} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, interestRate: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Term (Years)</span><input className="app-input w-full" type="number" value={rentVsBuyForm.termYears} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, termYears: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tax / Year</span><input className="app-input w-full" type="number" value={rentVsBuyForm.propertyTaxAnnual} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, propertyTaxAnnual: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Insurance / Year</span><input className="app-input w-full" type="number" value={rentVsBuyForm.insuranceAnnual} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, insuranceAnnual: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">HOA / Month</span><input className="app-input w-full" type="number" value={rentVsBuyForm.hoaMonthly} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, hoaMonthly: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">PMI / Month</span><input className="app-input w-full" type="number" value={rentVsBuyForm.pmiMonthly} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, pmiMonthly: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Maintenance (% / yr)</span><input className="app-input w-full" type="number" step="0.01" value={rentVsBuyForm.maintenanceRatePct} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, maintenanceRatePct: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Buy Closing Cost (%)</span><input className="app-input w-full" type="number" step="0.01" value={rentVsBuyForm.closingCostPct} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, closingCostPct: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sale Cost (%)</span><input className="app-input w-full" type="number" step="0.01" value={rentVsBuyForm.sellCostPct} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, sellCostPct: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Home Appreciation (%)</span><input className="app-input w-full" type="number" step="0.01" value={rentVsBuyForm.appreciationPct} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, appreciationPct: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rent / Month</span><input className="app-input w-full" type="number" value={rentVsBuyForm.rentMonthly} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, rentMonthly: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rent Growth (% / yr)</span><input className="app-input w-full" type="number" step="0.01" value={rentVsBuyForm.rentIncreasePct} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, rentIncreasePct: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invest Return (%)</span><input className="app-input w-full" type="number" step="0.01" value={rentVsBuyForm.investReturnPct} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, investReturnPct: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Horizon (Years)</span><input className="app-input w-full" type="number" value={rentVsBuyForm.horizonYears} onChange={(event) => setRentVsBuyForm((current) => ({ ...current, horizonYears: event.target.value }))} /></label>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{rentVsBuySummary.recommendation}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm text-slate-700">
                    <p>Owner total / month: <span className="font-semibold text-slate-900">{formatCurrency(rentVsBuySummary.monthlyOwnerTotal)}</span></p>
                    <p>Rent paid ({rentVsBuySummary.horizonYears}Y): <span className="font-semibold text-slate-900">{formatCurrency(rentVsBuySummary.totalRentPaid)}</span></p>
                    <p>Owner net cost: <span className="font-semibold text-slate-900">{formatCurrency(rentVsBuySummary.ownerNetCost)}</span></p>
                    <p>Renter net cost: <span className="font-semibold text-slate-900">{formatCurrency(rentVsBuySummary.renterNetCost)}</span></p>
                  </div>
                  <p className={`mt-2 text-sm font-semibold ${rentVsBuySummary.buyVsRentDelta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {rentVsBuySummary.buyVsRentDelta >= 0 ? "Buy advantage" : "Rent advantage"}: {formatCurrency(Math.abs(rentVsBuySummary.buyVsRentDelta))}
                  </p>
                </div>
              </div>

              <div className="app-panel p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold text-slate-900">Pay Down Mortgage vs Invest</p>
                    <p className="text-sm text-slate-500">Decide where extra monthly cash may work harder.</p>
                  </div>
                  <button className="app-btn-neutral" onClick={handleResetPaydownVsInvestDefaults}>
                    Reset Defaults
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mortgage Balance</span><input className="app-input w-full" type="number" value={paydownVsInvestForm.mortgageBalance} onChange={(event) => setPaydownVsInvestForm((current) => ({ ...current, mortgageBalance: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mortgage Rate (%)</span><input className="app-input w-full" type="number" step="0.01" value={paydownVsInvestForm.mortgageRatePct} onChange={(event) => setPaydownVsInvestForm((current) => ({ ...current, mortgageRatePct: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Years Remaining</span><input className="app-input w-full" type="number" value={paydownVsInvestForm.yearsRemaining} onChange={(event) => setPaydownVsInvestForm((current) => ({ ...current, yearsRemaining: event.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extra Cash / Month</span><input className="app-input w-full" type="number" value={paydownVsInvestForm.extraMonthly} onChange={(event) => setPaydownVsInvestForm((current) => ({ ...current, extraMonthly: event.target.value }))} /></label>
                  <label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expected Invest Return (%)</span><input className="app-input w-full" type="number" step="0.01" value={paydownVsInvestForm.investReturnPct} onChange={(event) => setPaydownVsInvestForm((current) => ({ ...current, investReturnPct: event.target.value }))} /></label>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{paydownVsInvestSummary.recommendation}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm text-slate-700">
                    <p>Paydown-path portfolio ({paydownVsInvestSummary.yearsRemaining}Y): <span className="font-semibold text-slate-900">{formatCurrency(paydownVsInvestSummary.paydownFutureValue)}</span></p>
                    <p>Invest-path portfolio ({paydownVsInvestSummary.yearsRemaining}Y): <span className="font-semibold text-slate-900">{formatCurrency(paydownVsInvestSummary.investFutureValue)}</span></p>
                    <p>Scheduled mortgage payment: <span className="font-semibold text-slate-900">{formatCurrency(paydownVsInvestSummary.scheduledMonthlyPayment)}</span></p>
                    <p>Interest saved from prepaying: <span className="font-semibold text-slate-900">{formatCurrency(paydownVsInvestSummary.interestSaved)}</span></p>
                    <p>Mortgage paid off with extra: <span className="font-semibold text-slate-900">{(paydownVsInvestSummary.payoffMonthWithExtra / 12).toFixed(1)} years</span></p>
                    <p>Months freed to invest full payment: <span className="font-semibold text-slate-900">{paydownVsInvestSummary.monthsFreed}</span></p>
                    <p>Break-even invest return: <span className="font-semibold text-slate-900">{paydownVsInvestSummary.breakEvenReturnPct.toFixed(2)}%</span></p>
                    <p>Extra monthly modeled: <span className="font-semibold text-slate-900">{formatCurrency(paydownVsInvestSummary.extraMonthly)}</span></p>
                  </div>
                  <p className={`mt-2 text-sm font-semibold ${paydownVsInvestSummary.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {paydownVsInvestSummary.delta >= 0 ? "Investing advantage" : "Paydown advantage"}: {formatCurrency(Math.abs(paydownVsInvestSummary.delta))}
                  </p>
                </div>
              </div>
            </div>

            <div className="app-panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-slate-900">Bank Sync (Plaid)</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Start linking accounts now; transaction syncing can layer on next.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="app-btn-neutral"
                    onClick={async () => {
                      await handleRefreshPlaidStatus();
                      await handleRefreshPlaidTransactions();
                    }}
                    disabled={plaidBusy || plaidSyncBusy}
                  >
                    Refresh Status
                  </button>
                  <button
                    className="app-btn-neutral"
                    onClick={() => void handleSyncPlaidTransactions()}
                    disabled={plaidSyncBusy || (plaidStatus !== null && !plaidStatus.configured)}
                  >
                    {plaidSyncBusy ? "Syncing..." : "Sync Transactions"}
                  </button>
                  <button
                    className="app-btn-danger"
                    onClick={() => void handleRemoveAllSyncedTransactions()}
                    disabled={plaidSyncBusy || plaidBusy}
                  >
                    Clear Synced
                  </button>
                  <button
                    className="app-btn-primary"
                    onClick={handleConnectBank}
                    disabled={plaidBusy || plaidSyncBusy || (plaidStatus !== null && !plaidStatus.configured)}
                  >
                    {plaidBusy ? "Opening Plaid..." : "Connect Bank"}
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-600">History window for new links:</p>
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                  {PLAID_HISTORY_OPTIONS.map((option) => (
                    <button
                      key={`plaid-days-${option.days}`}
                      className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                        plaidHistoryDaysRequested === option.days
                          ? "bg-sky-600 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                      onClick={() => setPlaidHistoryDaysRequested(option.days)}
                      disabled={plaidBusy || plaidSyncBusy}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Applies on next Connect Bank. Re-link if you change this.
                </p>
              </div>
                <div className="mt-3 grid gap-3 md:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Plaid Environment</p>
                  <p className="mt-1 font-semibold text-slate-900">{plaidStatus?.env ?? "unknown"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">History Requested</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {plaidHistoryDaysRequested} days
                    {plaidStatus?.daysRequested ? ` (server default ${plaidStatus.daysRequested})` : ""}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Configuration</p>
                  <p className={`mt-1 font-semibold ${plaidStatus?.configured ? "text-emerald-700" : "text-amber-700"}`}>
                    {plaidStatus?.configured ? "Ready" : "Missing API keys"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Linked Items (This User)</p>
                  <p className="mt-1 font-semibold text-slate-900">{plaidStatus?.itemCount ?? 0}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Synced Transactions</p>
                  <p className="mt-1 font-semibold text-slate-900">{plaidStatus?.syncedTransactionCount ?? plaidSyncedTransactions.length}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  id="plaid-auto-filter"
                  type="checkbox"
                  checked={plaidAutoFilterEnabled}
                  onChange={(event) => setPlaidAutoFilterEnabled(event.target.checked)}
                />
                <label htmlFor="plaid-auto-filter" className="text-sm text-slate-700">
                  Auto filter pending and transfer-like transactions
                </label>
              </div>
              {plaidStatus?.configured === false ? (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Add `PLAID_CLIENT_ID`, `PLAID_SECRET`, and optional `PLAID_ENV` (`sandbox`, `development`, `production`) before connecting.
                </p>
              ) : null}
              {plaidMessage ? (
                <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                  {plaidMessage}
                </p>
              ) : null}
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Latest Synced Transactions</p>
                <p className="mt-1 text-xs text-slate-500">Preview from Plaid sync cache (newest first).</p>
                {plaidSyncedTransactions.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No synced transactions yet. Click `Sync Transactions` to fetch data.</p>
                ) : (
                  <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                    {plaidSyncedTransactions.slice(0, 30).map((tx) => (
                      <div key={tx.transactionId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">{tx.merchantName ?? tx.name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {tx.date} - {tx.accountName ?? tx.accountId}
                            {tx.pending ? " - pending" : ""}
                          </p>
                        </div>
                        <p className={`ml-3 whitespace-nowrap text-sm font-semibold ${tx.amount > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                          {formatCurrency(tx.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">Backend supports `/link/token/create`, `/item/public_token/exchange`, and `/transactions/sync`.</div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">Sync uses Plaid cursor tracking so future pulls only fetch deltas.</div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">Next step: map synced rows into budget categories + accept/import workflow.</div>
              </div>
            </div>
          </div>
        )}

        {activeView === "goal_planning" && (
          <div className="space-y-5">
            <div className="app-panel-strong p-5">
              <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-sm text-violet-700">G</span>
                Goal Planning
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Start with your existing savings goals and timeline. This is the base layer before API-backed market confidence modeling.
              </p>
            </div>

            <div className="app-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Quick Templates</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Applies to {plannerExpandedGoalId !== null ? "the expanded goal" : "the first goal"}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PLANNER_TEMPLATES.map((template) => (
                    <button
                      key={`global-template-${template.id}`}
                      className="app-btn-neutral px-3 py-1.5 text-xs"
                      onClick={() => handleApplyQuickTemplate(template.id)}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {goals.length === 0 ? (
              <div className="app-panel p-8 text-center">
                <p className="text-gray-600">No savings goals yet. Add a goal in the Budget view to start planning.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {goals.map((goal, index) => {
                  const config = plannerConfigs[goal.id] ?? {
                    targetDate: "",
                    allocations: [
                      { symbol: "SPY", percent: "70", dollars: "0" },
                      { symbol: "VEA", percent: "30", dollars: "0" },
                    ],
                    planMode: "confidence" as PlannerPlanMode,
                    monthlyContribution: "300",
                    targetConfidence: "70",
                    trackingMode: "market" as PlannerTrackingMode,
                    fixedApr: "4.0",
                    isRetirementAccount: false,
                    retirementAnnualSpendGoal: "60000",
                    safeWithdrawalRate: "4.0",
                    retirementTargetMode: "swr" as RetirementTargetMode,
                    expectedRealReturn: "3.0",
                    taxHouseholdIncome: "140000",
                    taxFilingStatus: "married_joint" as TaxFilingStatus,
                    taxStateCode: "TX",
                    taxAccountType: "traditional_401k" as TaxAccountType,
                    taxableWithdrawalGoal: String(goal.targetAmount),
                    taxableCostBasisPercent: "75",
                    costBasisMode: "auto" as CostBasisMode,
                    benchmarkSymbol: "SPY",
                    riskFreeRate: "2.0",
                  };
                  const isExpanded = plannerExpandedGoalId === goal.id;
                  const isAllocationPanelOpen = plannerAllocationPanelOpenByGoal[goal.id] ?? true;
                  const isRetirementGoal = config.isRetirementAccount;
                  const safeWithdrawalRate = Number(config.safeWithdrawalRate);
                  const safeWithdrawalRatePct =
                    Number.isFinite(safeWithdrawalRate) && safeWithdrawalRate >= 0
                      ? safeWithdrawalRate
                      : 0;
                  const expectedRealReturn = Number(config.expectedRealReturn);
                  const expectedRealReturnPct =
                    Number.isFinite(expectedRealReturn) && expectedRealReturn >= 0
                      ? expectedRealReturn
                      : 0;
                  const annualSpendGoal = Number(config.retirementAnnualSpendGoal);
                  const annualSpendGoalValue =
                    Number.isFinite(annualSpendGoal) && annualSpendGoal >= 0 ? annualSpendGoal : 0;
                  const swrTargetAmount =
                    safeWithdrawalRatePct > 0
                      ? annualSpendGoalValue / (safeWithdrawalRatePct / 100)
                      : 0;
                  const preservePrincipalTargetAmount =
                    expectedRealReturnPct > 0
                      ? annualSpendGoalValue / (expectedRealReturnPct / 100)
                      : 0;
                  const retirementTargetAmount =
                    isRetirementGoal
                      ? config.retirementTargetMode === "preserve_principal"
                        ? preservePrincipalTargetAmount > 0
                          ? preservePrincipalTargetAmount
                          : goal.targetAmount
                        : swrTargetAmount > 0
                          ? swrTargetAmount
                          : goal.targetAmount
                      : goal.targetAmount;
                  const summary = plannerSummaryForGoal(goal, config, retirementTargetAmount);
                  const allocations = sanitizeAllocations(
                    config.allocations,
                    summary.currentSaved,
                  );
                  const allocationRules = allocationValidation(config.allocations);
                  const marketState = plannerMarketByGoal[goal.id] ?? { status: "idle", quotes: [] as MarketQuote[] };
                  const selectedMarketWindow = plannerMarketWindowByGoal[goal.id] ?? "1D";
                  const selectedReturnLookback = plannerReturnLookbackByGoal[goal.id] ?? "2Y";
                  const projectionStartMonthKey = getMonthKey(new Date());
                  const isMarketTracking = config.trackingMode === "market";
                  const quoteBySymbol = new Map(
                    marketState.quotes.map((quote) => [quote.symbol, quote]),
                  );
                  const weightedChangePct = allocations.reduce((running, allocation) => {
                    const quote = quoteBySymbol.get(allocation.symbol);
                    const windowChange =
                      selectedMarketWindow === "1D"
                        ? quote?.changePct
                        : quote?.periodChanges?.[selectedMarketWindow];
                    if (windowChange === undefined) return running;
                    return running + windowChange * (allocation.percent / 100);
                  }, 0);
                  const monthlyPortfolioByMonth = new Map<string, { weightedReturnPct: number; coveredWeight: number }>();
                  allocations.forEach((allocation) => {
                    const quote = quoteBySymbol.get(allocation.symbol);
                    quote?.monthlyReturns?.forEach((point) => {
                      const current = monthlyPortfolioByMonth.get(point.month) ?? {
                        weightedReturnPct: 0,
                        coveredWeight: 0,
                      };
                      current.weightedReturnPct += point.returnPct * (allocation.percent / 100);
                      current.coveredWeight += allocation.percent;
                      monthlyPortfolioByMonth.set(point.month, current);
                    });
                  });
                  const sortedMonthlyPortfolioEntries = Array.from(monthlyPortfolioByMonth.entries())
                    .sort(([a], [b]) => a.localeCompare(b));
                  const latestPortfolioMonth = sortedMonthlyPortfolioEntries.at(-1)?.[0];
                  const lookbackMonths = RETURN_LOOKBACK_MONTHS[selectedReturnLookback];
                  const lookbackStartMonth =
                    latestPortfolioMonth !== undefined
                      ? shiftMonth(latestPortfolioMonth, -(lookbackMonths - 1))
                      : undefined;
                  const lookbackMonthlyEntries = sortedMonthlyPortfolioEntries.filter(([month]) =>
                    lookbackStartMonth ? month >= lookbackStartMonth : true,
                  );
                  const fixedAprValue = Number(config.fixedApr);
                  const fixedMonthlyReturnPct =
                    Number.isFinite(fixedAprValue) ? (fixedAprValue / 12) : 0;
                  const marketMonthlyReturns = lookbackMonthlyEntries
                    .filter(([, point]) => point.coveredWeight >= 99.9)
                    .map(([, point]) => point.weightedReturnPct);
                  const portfolioMonthlyReturns = isMarketTracking
                    ? marketMonthlyReturns
                    : Array.from(
                        { length: Math.max(lookbackMonths, 12) },
                        () => fixedMonthlyReturnPct,
                      );
                  const monthlyCoveragePercent = isMarketTracking
                    ? lookbackMonthlyEntries.length === 0
                      ? 0
                      : (lookbackMonthlyEntries.filter(([, point]) => point.coveredWeight >= 99.9).length /
                          lookbackMonthlyEntries.length) *
                        100
                    : 100;
                  const averageMonthlyReturnPct =
                    portfolioMonthlyReturns.length === 0
                      ? 0
                      : portfolioMonthlyReturns.reduce((sum, value) => sum + value, 0) /
                        portfolioMonthlyReturns.length;
                  const annualizedReturnUsedPct =
                    portfolioMonthlyReturns.length === 0
                      ? 0
                      : ((1 + averageMonthlyReturnPct / 100) ** 12 - 1) * 100;
                  const benchmarkSymbol = config.benchmarkSymbol.trim().toUpperCase() || "SPY";
                  const riskFreeRateInput = Number(config.riskFreeRate);
                  const riskFreeRatePct =
                    Number.isFinite(riskFreeRateInput) && riskFreeRateInput >= 0
                      ? riskFreeRateInput
                      : 0;
                  const benchmarkQuote = quoteBySymbol.get(benchmarkSymbol);
                  const benchmarkMonthlyByMonth = new Map(
                    (benchmarkQuote?.monthlyReturns ?? []).map((point) => [point.month, point.returnPct]),
                  );
                  const overlappingRiskMonths = lookbackMonthlyEntries.filter(
                    ([month, point]) =>
                      point.coveredWeight >= 99.9 && benchmarkMonthlyByMonth.has(month),
                  );
                  const benchmarkMonthlyReturns = overlappingRiskMonths.map(
                    ([month]) => benchmarkMonthlyByMonth.get(month) ?? 0,
                  );
                  const overlappingPortfolioReturns = overlappingRiskMonths.map(
                    ([, point]) => point.weightedReturnPct,
                  );
                  const riskMetrics = calculateRiskMetrics({
                    portfolioMonthlyReturnsPct: isMarketTracking ? overlappingPortfolioReturns : [],
                    benchmarkMonthlyReturnsPct: isMarketTracking ? benchmarkMonthlyReturns : [],
                    benchmarkSymbol,
                    riskFreeRatePct,
                  });
                  const parsedMonthlyContribution = Number(config.monthlyContribution);
                  const inputMonthlyContribution =
                    Number.isFinite(parsedMonthlyContribution) && parsedMonthlyContribution >= 0
                      ? parsedMonthlyContribution
                      : 0;
                  const parsedTargetConfidence = Number(config.targetConfidence);
                  const targetConfidenceProbability =
                    Number.isFinite(parsedTargetConfidence)
                      ? Math.min(Math.max(parsedTargetConfidence / 100, 0.01), 0.99)
                      : 0.7;
                  const contributionScenarioFinalValues = simulateFinalFundValues(
                    summary.currentSaved,
                    inputMonthlyContribution,
                    summary.monthsToGoal,
                    portfolioMonthlyReturns,
                  );
                  const contributionTargetHitProbability = successProbability(
                    contributionScenarioFinalValues,
                    summary.targetAmount,
                  );
                  const confidenceRequiredMonthlyContribution = requiredMonthlyContributionForProbability(
                    summary.currentSaved,
                    summary.monthsToGoal,
                    summary.targetAmount,
                    portfolioMonthlyReturns,
                    targetConfidenceProbability,
                  );
                  const activeMonthlyContribution =
                    config.planMode === "contribution"
                      ? inputMonthlyContribution
                      : confidenceRequiredMonthlyContribution;
                  const activeHitProbability =
                    config.planMode === "contribution"
                      ? contributionTargetHitProbability
                      : targetConfidenceProbability;
                  const activeScenarioFinalValues = simulateFinalFundValues(
                    summary.currentSaved,
                    activeMonthlyContribution,
                    summary.monthsToGoal,
                    portfolioMonthlyReturns,
                  );
                  const baseGrowthTrajectory = buildNoReturnTrajectory(
                    summary.currentSaved,
                    activeMonthlyContribution,
                    summary.monthsToGoal,
                  );
                  const returnGrowthTrajectories = simulatePercentileTrajectories(
                    summary.currentSaved,
                    activeMonthlyContribution,
                    summary.monthsToGoal,
                    portfolioMonthlyReturns,
                  );
                  const profileFinalP25 = percentile(activeScenarioFinalValues, 0.25);
                  const profileFinalP50 = percentile(activeScenarioFinalValues, 0.5);
                  const profileFinalP75 = percentile(activeScenarioFinalValues, 0.75);
                  const taxHouseholdIncome = Number(config.taxHouseholdIncome);
                  const normalizedTaxHouseholdIncome =
                    Number.isFinite(taxHouseholdIncome) && taxHouseholdIncome >= 0 ? taxHouseholdIncome : 0;
                  const inferredOrdinaryTaxRate = federalOrdinaryMarginalRate(
                    normalizedTaxHouseholdIncome,
                    config.taxFilingStatus,
                  );
                  const inferredCapGainsTaxRate = federalCapitalGainsRate(
                    normalizedTaxHouseholdIncome,
                    config.taxFilingStatus,
                  );
                  const inferredStateTaxRate = estimatedStateIncomeTaxRate(config.taxStateCode);
                  const effectiveAccountType: TaxAccountType = isRetirementGoal
                    ? config.taxAccountType
                    : "taxable_mixed";
                  const accountMix = accountTaxMix(effectiveAccountType);
                  const normalizedOrdinaryShare = Math.max(accountMix.ordinaryShare, 0);
                  const normalizedCapGainsShare = Math.max(accountMix.capGainsShare, 0);
                  const shareTotal = normalizedOrdinaryShare + normalizedCapGainsShare;
                  const ordinaryWeight = shareTotal > 0 ? normalizedOrdinaryShare / shareTotal : 0.7;
                  const capGainsWeight = shareTotal > 0 ? normalizedCapGainsShare / shareTotal : 0.3;
                  const effectiveTaxRate =
                    effectiveAccountType === "roth_401k"
                      ? 0
                      : ordinaryWeight *
                          (inferredOrdinaryTaxRate + inferredStateTaxRate) +
                        capGainsWeight *
                          (inferredCapGainsTaxRate + inferredStateTaxRate);
                  const clampedEffectiveTaxRate = Math.min(Math.max(effectiveTaxRate, 0), 95);
                  const combinedCapGainsTaxRate = Math.min(
                    Math.max(inferredCapGainsTaxRate + inferredStateTaxRate, 0),
                    95,
                  );
                  const taxableWithdrawalGoalValue = goal.targetAmount;
                  const projectedBasisAmountRaw =
                    Math.max(summary.currentSaved, 0) +
                    Math.max(activeMonthlyContribution, 0) * Math.max(summary.monthsToGoal, 0);
                  const estimatedBasisAmount = Math.min(
                    projectedBasisAmountRaw,
                    Math.max(profileFinalP50, 0),
                  );
                  const autoCostBasisPercent =
                    profileFinalP50 > 0
                      ? (estimatedBasisAmount / profileFinalP50) * 100
                      : 100;
                  const taxableCostBasisPercent = Number(config.taxableCostBasisPercent);
                  const manualCostBasisPercent = Math.min(
                    Math.max(
                      Number.isFinite(taxableCostBasisPercent) ? taxableCostBasisPercent : 75,
                      0,
                    ),
                    100,
                  );
                  const selectedCostBasisPercent =
                    config.costBasisMode === "manual" ? manualCostBasisPercent : autoCostBasisPercent;
                  const gainPortion = 1 - selectedCostBasisPercent / 100;
                  const effectiveTaxOnWithdrawalRate = gainPortion * (combinedCapGainsTaxRate / 100);
                  const requiredGrossWithdrawalForGoal =
                    taxableWithdrawalGoalValue /
                    Math.max(1 - effectiveTaxOnWithdrawalRate, 0.05);
                  const estimatedTaxPaidForGoal =
                    requiredGrossWithdrawalForGoal - taxableWithdrawalGoalValue;
                  const projectedAfterTaxLumpSumFromP50 =
                    profileFinalP50 * (1 - effectiveTaxOnWithdrawalRate);
                  const projectedTaxPaidFromP50 =
                    profileFinalP50 - projectedAfterTaxLumpSumFromP50;
                  const projectedGrossRetirementIncome = profileFinalP50 * (safeWithdrawalRatePct / 100);
                  const projectedAfterTaxRetirementIncome =
                    projectedGrossRetirementIncome * (1 - clampedEffectiveTaxRate / 100);
                  const projectedRetirementTaxPaidAnnual =
                    projectedGrossRetirementIncome - projectedAfterTaxRetirementIncome;
                  const requiredGrossRetirementIncomeForSpendGoal =
                    annualSpendGoalValue /
                    Math.max(1 - clampedEffectiveTaxRate / 100, 0.05);
                  const requiredRetirementTaxPaidAnnual =
                    requiredGrossRetirementIncomeForSpendGoal - annualSpendGoalValue;
                  const requiredRetirementBalanceForSpendGoal = summary.targetAmount;
                  const projectedAfterTaxMonthlyIncome = projectedAfterTaxRetirementIncome / 12;
                  const retirementIncomeGap = projectedAfterTaxRetirementIncome - annualSpendGoalValue;
                  const hasProjectionData = summary.monthsToGoal > 0 && portfolioMonthlyReturns.length > 0;
                  const projectionStatus = projectionStatusSummary({
                    hasProjectionData,
                    currentSaved: summary.currentSaved,
                    targetAmount: summary.targetAmount,
                    hitProbability: activeHitProbability,
                    targetConfidenceProbability,
                    requiredMonthlyForConfidence: confidenceRequiredMonthlyContribution,
                  });
                  const annualCoveragePercent = allocations.reduce((running, allocation) => {
                    const quote = quoteBySymbol.get(allocation.symbol);
                    const hasAnnualData = quote?.periodChanges?.["1Y"] !== undefined;
                    return hasAnnualData ? running + allocation.percent : running;
                  }, 0);
                  const effectiveAnnualCoveragePercent = isMarketTracking ? annualCoveragePercent : 100;
                  const activeRiskInfo = plannerRiskInfoOpenByGoal[goal.id] ?? null;
                  const tintStyles = [
                    "bg-sky-100 text-sky-700",
                    "bg-emerald-100 text-emerald-700",
                    "bg-amber-100 text-amber-700",
                    "bg-rose-100 text-rose-700",
                  ];

                  return (
                    <div key={goal.id} className="overflow-hidden app-panel-strong">
                      <button
                        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                        onClick={() => setPlannerExpandedGoalId((current) => (current === goal.id ? null : goal.id))}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${tintStyles[index % tintStyles.length]}`}>
                            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="8" />
                              <path d="M12 7v10" />
                              <path d="M15.5 9.5A3.5 3.5 0 0 0 12.5 8H11a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 1 0 5h-1.5a3.5 3.5 0 0 1-3-1.5" />
                            </svg>
                          </span>
                          <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${projectionStatus.toneClass}`}>
                                {projectionStatus.label}
                              </span>
                              <span className="truncate text-xs text-gray-600">{projectionStatus.message}</span>
                            </div>
                            <p className="truncate text-lg font-semibold text-gray-900">{goal.name}</p>
                            <p className="text-sm text-gray-500">
                              Saved {formatCurrency(summary.currentSaved)} / {formatCurrency(summary.targetAmount)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-500">Plan / Month</p>
                          <p className="text-lg font-semibold text-gray-900">{formatCurrency(activeMonthlyContribution)}</p>
                          <p className="text-xs text-gray-400">{summary.monthsToGoal} months</p>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100 px-5 py-5">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Target Date</p>
                              <input
                                className="app-input w-full"
                                type="date"
                                value={config.targetDate}
                                onChange={(event) =>
                                  setPlannerConfigs((current) => ({
                                    ...current,
                                    [goal.id]: { ...config, targetDate: event.target.value },
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Asset Type</p>
                              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
                                <button
                                  className={`px-3 py-2 text-xs font-medium ${
                                    config.trackingMode === "market"
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-gray-600"
                                  }`}
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, trackingMode: "market" },
                                    }))
                                  }
                                >
                                  Market
                                </button>
                                <button
                                  className={`px-3 py-2 text-xs font-medium ${
                                    config.trackingMode === "fixed"
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-gray-600"
                                  }`}
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, trackingMode: "fixed" },
                                    }))
                                  }
                                >
                                  Fixed
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Retirement Mode</p>
                              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
                                <button
                                  className={`px-3 py-2 text-xs font-medium ${
                                    isRetirementGoal
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-gray-600"
                                  }`}
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, isRetirementAccount: true },
                                    }))
                                  }
                                >
                                  Retirement
                                </button>
                                <button
                                  className={`px-3 py-2 text-xs font-medium ${
                                    !isRetirementGoal
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-gray-600"
                                  }`}
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, isRetirementAccount: false },
                                    }))
                                  }
                                >
                                  General
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Planning Mode</p>
                              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
                                <button
                                  className={`px-3 py-2 text-xs font-medium ${
                                    config.planMode === "contribution"
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-gray-600"
                                  }`}
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, planMode: "contribution" },
                                    }))
                                  }
                                >
                                  Monthly $
                                </button>
                                <button
                                  className={`px-3 py-2 text-xs font-medium ${
                                    config.planMode === "confidence"
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-gray-600"
                                  }`}
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, planMode: "confidence" },
                                    }))
                                  }
                                >
                                  Confidence %
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                {config.planMode === "contribution" ? "Monthly Contribution" : "Target Confidence (%)"}
                              </p>
                              <input
                                className="app-input w-full"
                                type="number"
                                min={config.planMode === "contribution" ? 0 : 1}
                                max={config.planMode === "contribution" ? undefined : 99}
                                step="0.1"
                                value={config.planMode === "contribution" ? config.monthlyContribution : config.targetConfidence}
                                onChange={(event) =>
                                  setPlannerConfigs((current) => ({
                                    ...current,
                                    [goal.id]:
                                      config.planMode === "contribution"
                                        ? { ...config, monthlyContribution: event.target.value }
                                        : { ...config, targetConfidence: event.target.value },
                                  }))
                                }
                                placeholder={config.planMode === "contribution" ? "300" : "70"}
                              />
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                {config.planMode === "contribution" ? "Estimated Hit Chance" : "Required / Month"}
                              </p>
                              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900">
                                {config.planMode === "contribution"
                                  ? `${(contributionTargetHitProbability * 100).toFixed(1)}%`
                                  : formatCurrency(confidenceRequiredMonthlyContribution)}
                              </div>
                            </div>
                          </div>

                          {isRetirementGoal ? (
                          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                            <p className="text-sm font-semibold text-gray-800">Retirement & Tax Assumptions</p>
                            <p className="mt-1 text-xs text-gray-500">
                              Enter household profile once and taxes are estimated automatically.
                            </p>
                            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Annual Spend Goal ($)</p>
                                <input
                                  className="app-input w-full"
                                  type="number"
                                  value={config.retirementAnnualSpendGoal}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, retirementAnnualSpendGoal: event.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Safe Withdrawal Rate (%)</p>
                                <input
                                  className="app-input w-full"
                                  type="number"
                                  step="0.1"
                                  value={config.safeWithdrawalRate}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, safeWithdrawalRate: event.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Retirement Target Method</p>
                                <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
                                  <button
                                    className={`px-3 py-2 text-xs font-medium ${
                                      config.retirementTargetMode === "swr"
                                        ? "bg-slate-900 text-white"
                                        : "bg-white text-gray-600"
                                    }`}
                                    onClick={() =>
                                      setPlannerConfigs((current) => ({
                                        ...current,
                                        [goal.id]: { ...config, retirementTargetMode: "swr" },
                                      }))
                                    }
                                  >
                                    SWR
                                  </button>
                                  <button
                                    className={`px-3 py-2 text-xs font-medium ${
                                      config.retirementTargetMode === "preserve_principal"
                                        ? "bg-slate-900 text-white"
                                        : "bg-white text-gray-600"
                                    }`}
                                    onClick={() =>
                                      setPlannerConfigs((current) => ({
                                        ...current,
                                        [goal.id]: { ...config, retirementTargetMode: "preserve_principal" },
                                      }))
                                    }
                                  >
                                    Preserve Principal
                                  </button>
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Expected Real Return (%)</p>
                                <input
                                  className="app-input w-full"
                                  type="number"
                                  step="0.1"
                                  value={config.expectedRealReturn}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, expectedRealReturn: event.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Household Income ($)</p>
                                <input
                                  className="app-input w-full"
                                  type="number"
                                  value={config.taxHouseholdIncome}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, taxHouseholdIncome: event.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Filing Status</p>
                                <select
                                  className="app-input w-full"
                                  value={config.taxFilingStatus}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: {
                                        ...config,
                                        taxFilingStatus:
                                          event.target.value === "single" ? "single" : "married_joint",
                                      },
                                    }))
                                  }
                                >
                                  <option value="married_joint">Married Joint</option>
                                  <option value="single">Single</option>
                                </select>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">State</p>
                                <input
                                  className="app-input w-full"
                                  value={config.taxStateCode}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, taxStateCode: event.target.value.toUpperCase() },
                                    }))
                                  }
                                  placeholder="TX"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Retirement Account Type</p>
                                <select
                                  className="app-input w-full"
                                  value={config.taxAccountType}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: {
                                        ...config,
                                        taxAccountType:
                                          event.target.value === "roth_401k"
                                            ? "roth_401k"
                                            : event.target.value === "taxable_mixed"
                                              ? "taxable_mixed"
                                              : "traditional_401k",
                                      },
                                    }))
                                  }
                                >
                                  <option value="traditional_401k">Traditional 401(k)</option>
                                  <option value="roth_401k">Roth 401(k)</option>
                                  <option value="taxable_mixed">Taxable Mixed</option>
                                </select>
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ordinary Tax Used</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">{inferredOrdinaryTaxRate.toFixed(1)}%</p>
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Capital Gains Tax Used</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">{inferredCapGainsTaxRate.toFixed(1)}%</p>
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">State Tax Used</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">{inferredStateTaxRate.toFixed(1)}%</p>
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Blended Effective Tax</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">{clampedEffectiveTaxRate.toFixed(2)}%</p>
                              </div>
                            </div>
                            <div className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs">
                              <p className="font-semibold text-gray-700">Derived Retirement Target In Use</p>
                              <p className="mt-1 text-gray-600">
                                {config.retirementTargetMode === "preserve_principal"
                                  ? `Preserve Principal: ${formatCurrency(summary.targetAmount)} (Spend ${formatCurrency(annualSpendGoalValue)} / Real Return ${expectedRealReturnPct.toFixed(2)}%)`
                                  : `SWR: ${formatCurrency(summary.targetAmount)} (Spend ${formatCurrency(annualSpendGoalValue)} / SWR ${safeWithdrawalRatePct.toFixed(2)}%)`}
                              </p>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Needed For Spend Goal</p>
                                <p className="mt-1 text-xs text-gray-500">How much annual gross income and balance you need to support your after-tax spend goal.</p>
                                <p className="mt-2 text-sm text-gray-500">After-Tax Spend Goal / Year</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(annualSpendGoalValue)}</p>
                                <p className="mt-2 text-sm text-gray-500">Required Gross Income / Year</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(requiredGrossRetirementIncomeForSpendGoal)}</p>
                                <p className="mt-2 text-sm text-gray-500">Estimated Tax Paid / Year</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(requiredRetirementTaxPaidAnnual)}</p>
                                <p className="mt-2 text-sm text-gray-500">Required Retirement Balance</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(requiredRetirementBalanceForSpendGoal)}</p>
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Current Plan Projection (P50)</p>
                                <p className="mt-1 text-xs text-gray-500">What your projected balance is expected to support after tax.</p>
                                <p className="mt-2 text-sm text-gray-500">Projected Gross Income / Year</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(projectedGrossRetirementIncome)}</p>
                                <p className="mt-2 text-sm text-gray-500">Projected Tax Paid / Year</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(projectedRetirementTaxPaidAnnual)}</p>
                                <p className="mt-2 text-sm text-gray-500">Projected After-Tax Income / Year</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(projectedAfterTaxRetirementIncome)}</p>
                                <p className="mt-2 text-sm text-gray-500">Projected After-Tax Income / Month</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(projectedAfterTaxMonthlyIncome)}</p>
                              </div>
                            </div>
                            <div className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">After-Tax Spend Gap / Year (P50)</p>
                              <p className={`mt-1 text-sm font-semibold ${retirementIncomeGap < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                {retirementIncomeGap >= 0 ? "+" : ""}
                                {formatCurrency(retirementIncomeGap)}
                              </p>
                            </div>
                          </div>
                          ) : isMarketTracking ? (
                          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">Taxable Brokerage Withdrawal</p>
                                <p className="mt-1 text-xs text-gray-500">
                                  Estimate how much pre-tax balance you need to net your cash goal after capital-gains taxes.
                                </p>
                              </div>
                              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
                                <button
                                  className={`px-3 py-1.5 text-xs font-medium ${
                                    config.costBasisMode === "auto"
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-gray-600"
                                  }`}
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, costBasisMode: "auto" },
                                    }))
                                  }
                                >
                                  Auto
                                </button>
                                <button
                                  className={`px-3 py-1.5 text-xs font-medium ${
                                    config.costBasisMode === "manual"
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-gray-600"
                                  }`}
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, costBasisMode: "manual" },
                                    }))
                                  }
                                >
                                  Manual
                                </button>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Household Income ($)</p>
                                <input
                                  className="app-input w-full"
                                  type="number"
                                  value={config.taxHouseholdIncome}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, taxHouseholdIncome: event.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Filing Status</p>
                                <select
                                  className="app-input w-full"
                                  value={config.taxFilingStatus}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: {
                                        ...config,
                                        taxFilingStatus:
                                          event.target.value === "single" ? "single" : "married_joint",
                                      },
                                    }))
                                  }
                                >
                                  <option value="married_joint">Married Joint</option>
                                  <option value="single">Single</option>
                                </select>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">State</p>
                                <input
                                  className="app-input w-full"
                                  value={config.taxStateCode}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, taxStateCode: event.target.value.toUpperCase() },
                                    }))
                                  }
                                  placeholder="TX"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Cost Basis (%)</p>
                                <input
                                  className="app-input w-full disabled:bg-slate-50"
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max="100"
                                  disabled={config.costBasisMode === "auto"}
                                  value={config.costBasisMode === "auto" ? autoCostBasisPercent.toFixed(1) : config.taxableCostBasisPercent}
                                  onChange={(event) =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: { ...config, taxableCostBasisPercent: event.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Net Cash Goal (from Target Amount)</p>
                                <div className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900">
                                  {formatCurrency(taxableWithdrawalGoalValue)}
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Capital Gains Tax Used</p>
                                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900">
                                  {combinedCapGainsTaxRate.toFixed(2)}%
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Effective Tax on Withdrawal</p>
                                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900">
                                  {(effectiveTaxOnWithdrawalRate * 100).toFixed(2)}%
                                </div>
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Estimated Total Contributions</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">
                                  {formatCurrency(estimatedBasisAmount)} ({autoCostBasisPercent.toFixed(1)}%)
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Needed For Goal</p>
                                <p className="mt-1 text-xs text-gray-500">Required gross withdrawal to net your cash goal.</p>
                                <p className="mt-2 text-sm text-gray-500">Net Cash Goal</p>
                                <p className="text-sm font-semibold text-gray-900">{formatCurrency(taxableWithdrawalGoalValue)}</p>
                                <p className="mt-2 text-sm text-gray-500">Required Gross Withdrawal</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">
                                  {formatCurrency(requiredGrossWithdrawalForGoal)}
                                </p>
                                <p className="mt-2 text-sm text-gray-500">Estimated Tax Paid (Goal)</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">
                                  {formatCurrency(estimatedTaxPaidForGoal)}
                                </p>
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Current Plan Projection (P50)</p>
                                <p className="mt-1 text-xs text-gray-500">What your current allocation + contribution plan is forecast to produce.</p>
                                <p className="mt-2 text-sm text-gray-500">Projected Net</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">
                                  {formatCurrency(projectedAfterTaxLumpSumFromP50)}
                                </p>
                                <p className="mt-2 text-sm text-gray-500">Projected Gross</p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {formatCurrency(profileFinalP50)}
                                </p>
                                <p className="mt-2 text-sm text-gray-500">Projected Tax Paid (P50)</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">
                                  {formatCurrency(projectedTaxPaidFromP50)}
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Projected Net Gap Vs Goal (P50)</p>
                                <p className="mt-1 text-xs text-gray-500">Positive means projected net exceeds target; negative means shortfall.</p>
                                <p className={`mt-2 text-sm font-semibold ${projectedAfterTaxLumpSumFromP50 - taxableWithdrawalGoalValue < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                  {projectedAfterTaxLumpSumFromP50 - taxableWithdrawalGoalValue >= 0 ? "+" : ""}
                                  {formatCurrency(projectedAfterTaxLumpSumFromP50 - taxableWithdrawalGoalValue)}
                                </p>
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                              In this lump-sum model, required account balance is the same as required gross withdrawal.
                            </p>
                            {config.costBasisMode === "manual" ? (
                              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                Manual override is active. Tax estimates now use your entered basis % instead of the app's projected-at-withdrawal basis estimate.
                              </div>
                            ) : (
                              <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                                Auto basis uses projected principal at target date (current principal + planned contributions) versus projected ending balance.
                              </div>
                            )}
                          </div>
                          ) : null}

                          {isMarketTracking ? (
                          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-sm font-semibold text-gray-800">Portfolio Allocation Builder</p>
                              <div className="flex items-center gap-2">
                                <button
                                  className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white"
                                  onClick={() =>
                                    setPlannerConfigs((current) => ({
                                      ...current,
                                      [goal.id]: {
                                        ...config,
                                        allocations: [
                                          ...config.allocations,
                                          { symbol: "", percent: "", dollars: "" },
                                        ],
                                      },
                                    }))
                                  }
                                >
                                  + Allocation
                                </button>
                                <button
                                  className="rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700"
                                  onClick={() =>
                                    setPlannerAllocationPanelOpenByGoal((current) => ({
                                      ...current,
                                      [goal.id]: !isAllocationPanelOpen,
                                    }))
                                  }
                                >
                                  {isAllocationPanelOpen ? "Hide" : "Show"}
                                </button>
                              </div>
                            </div>

                            {isAllocationPanelOpen ? (
                              <>
                                <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                                  <div className="space-y-2">
                                    {config.allocations.map((allocation, allocationIndex) => (
                                      <div key={`${goal.id}-${allocationIndex}`} className="grid gap-2 md:grid-cols-[1fr_140px_160px_auto]">
                                        <input
                                          className="rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-sky-400"
                                          value={allocation.symbol}
                                          placeholder="Ticker (SPY)"
                                          onChange={(event) =>
                                            setPlannerConfigs((current) => ({
                                              ...current,
                                              [goal.id]: {
                                                ...config,
                                                allocations: config.allocations.map((item, index) =>
                                                  index === allocationIndex
                                                    ? { ...item, symbol: event.target.value.toUpperCase() }
                                                    : item,
                                                ),
                                              },
                                            }))
                                          }
                                        />
                                        <input
                                          className="rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-sky-400"
                                          type="number"
                                          value={allocation.percent}
                                          placeholder="Weight %"
                                          onChange={(event) =>
                                            setPlannerConfigs((current) => {
                                              const nextPercent = event.target.value;
                                              const parsedPercent = Number(nextPercent);
                                              const nextDollars =
                                                nextPercent === ""
                                                  ? ""
                                                  : Number.isFinite(parsedPercent) && summary.currentSaved > 0
                                                    ? ((summary.currentSaved * parsedPercent) / 100).toFixed(2)
                                                    : "0";
                                              return {
                                                ...current,
                                                [goal.id]: {
                                                  ...config,
                                                  allocations: config.allocations.map((item, index) =>
                                                    index === allocationIndex
                                                      ? { ...item, percent: nextPercent, dollars: nextDollars }
                                                      : item,
                                                  ),
                                                },
                                              };
                                            })
                                          }
                                        />
                                        <input
                                          className="rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-sky-400"
                                          type="number"
                                          value={allocation.dollars}
                                          placeholder="Amount $"
                                          onChange={(event) =>
                                            setPlannerConfigs((current) => {
                                              const nextDollars = event.target.value;
                                              const parsedDollars = Number(nextDollars);
                                              const nextPercent =
                                                nextDollars === ""
                                                  ? ""
                                                  : Number.isFinite(parsedDollars) && summary.currentSaved > 0
                                                    ? ((parsedDollars / summary.currentSaved) * 100).toFixed(2)
                                                    : "0";
                                              return {
                                                ...current,
                                                [goal.id]: {
                                                  ...config,
                                                  allocations: config.allocations.map((item, index) =>
                                                    index === allocationIndex
                                                      ? { ...item, dollars: nextDollars, percent: nextPercent }
                                                      : item,
                                                  ),
                                                },
                                              };
                                            })
                                          }
                                        />
                                        <button
                                          className="rounded-lg bg-red-100 px-3 py-2 text-xs font-medium text-red-700"
                                          onClick={() =>
                                            setPlannerConfigs((current) => ({
                                              ...current,
                                              [goal.id]: {
                                                ...config,
                                                allocations:
                                                  config.allocations.length > 1
                                                    ? config.allocations.filter((_, index) => index !== allocationIndex)
                                                    : config.allocations,
                                              },
                                            }))
                                          }
                                          disabled={config.allocations.length <= 1}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Allocation Mix</p>
                                    {allocations.length > 0 ? (
                                      <AllocationPieChart allocations={allocations} />
                                    ) : (
                                      <p className="text-sm text-gray-500">Add allocations to see the chart.</p>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                  <span className={`rounded-full px-3 py-1 font-medium ${
                                    allocationRules.hasExactHundred && allocationRules.hasPositiveDollarTotal
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-amber-100 text-amber-800"
                                  }`}>
                                    Total Percent: {allocationRules.totalPercent.toFixed(2)}% | Total Dollars:{" "}
                                    {formatCurrency(allocationRules.totalDollars)}
                                  </span>
                                  {allocationRules.invalidSymbolInputs.length > 0 ? (
                                    <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">
                                      Invalid tickers: {allocationRules.invalidSymbolInputs.join(", ")}
                                    </span>
                                  ) : null}
                                  {allocationRules.duplicateSymbols.length > 0 ? (
                                    <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">
                                      Duplicate tickers: {allocationRules.duplicateSymbols.join(", ")}
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-2 text-xs text-gray-500">
                                  Guideline: keep total weights at 100%, use valid ticker symbols (letters/numbers,
                                  optional dot or dash), and edit either % or $ to auto-sync the other.
                                </div>
                              </>
                            ) : (
                              <div className="text-xs text-gray-500">
                                Allocation builder is hidden. Click <span className="font-medium">Show</span> to edit rows and view the pie chart.
                              </div>
                            )}
                          </div>
                          ) : (
                            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                              <p className="text-sm font-semibold text-gray-800">Fixed Return Settings</p>
                              <p className="mt-1 text-xs text-gray-500">
                                In fixed mode, projections use a constant APR instead of market allocation returns.
                              </p>
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <div>
                                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Nominal APR (%)</p>
                                  <input
                                    className="app-input w-full"
                                    type="number"
                                    step="0.01"
                                    value={config.fixedApr}
                                    onChange={(event) =>
                                      setPlannerConfigs((current) => ({
                                        ...current,
                                        [goal.id]: { ...config, fixedApr: event.target.value },
                                      }))
                                    }
                                    placeholder="4.00"
                                  />
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Monthly Rate Used</p>
                                  <p className="mt-1 text-sm font-semibold text-gray-900">
                                    {(Number.isFinite(Number(config.fixedApr)) ? Number(config.fixedApr) / 12 : 0).toFixed(3)}%
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-xl bg-gray-50 p-4">
                              <p className="text-sm text-gray-500">Current Saved</p>
                              <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(summary.currentSaved)}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-4">
                              <p className="text-sm text-gray-500">Target Amount</p>
                              <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(summary.targetAmount)}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-4">
                              <p className="text-sm text-gray-500">Remaining To Goal</p>
                              <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(summary.remainingToTarget)}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-4">
                              <p className="text-sm text-gray-500">Projected Final Balance</p>
                              <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(profileFinalP50)}</p>
                            </div>
                          </div>

                          {isMarketTracking ? (
                          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">Live Market Snapshot</p>
                                <p className="text-xs text-gray-500">
                                  {marketState.fetchedAt
                                    ? `Updated ${new Date(marketState.fetchedAt).toLocaleString("en-US")}`
                                    : "Waiting for market data"}
                                </p>
                              </div>
                              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
                                {MARKET_WINDOWS.map((windowKey) => (
                                  <button
                                    key={`${goal.id}-${windowKey}`}
                                    className={`px-2 py-1 text-xs font-medium ${
                                      selectedMarketWindow === windowKey
                                        ? "bg-slate-900 text-white"
                                        : "text-gray-600 hover:bg-gray-50"
                                    }`}
                                    onClick={() =>
                                      setPlannerMarketWindowByGoal((current) => ({
                                        ...current,
                                        [goal.id]: windowKey,
                                      }))
                                    }
                                  >
                                    {MARKET_WINDOW_LABEL[windowKey]}
                                  </button>
                                ))}
                              </div>
                              {allocations.length > 0 ? (
                                <div className="text-right">
                                  <p className="text-xs text-gray-500">
                                    Weighted {MARKET_WINDOW_LABEL[selectedMarketWindow]} Move
                                  </p>
                                  <p className={`text-sm font-semibold ${weightedChangePct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                    {weightedChangePct >= 0 ? "+" : ""}
                                    {weightedChangePct.toFixed(2)}%
                                  </p>
                                </div>
                              ) : null}
                            </div>

                            {allocations.length === 0 ? (
                              <p className="mt-3 text-sm text-gray-500">
                                Add asset weights like <span className="font-medium">SPY 70%, VEA 30%</span> to load live quotes.
                              </p>
                            ) : marketState.status === "loading" ? (
                              <p className="mt-3 text-sm text-gray-500">Loading quotes...</p>
                            ) : marketState.status === "error" ? (
                              <p className="mt-3 text-sm text-red-600">{marketState.error ?? "Failed to load quotes."}</p>
                            ) : (
                              <>
                                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                  {allocations.map((allocation) => {
                                    const quote = quoteBySymbol.get(allocation.symbol);
                                    const windowChange =
                                      selectedMarketWindow === "1D"
                                        ? quote?.changePct
                                        : quote?.periodChanges?.[selectedMarketWindow];
                                    return (
                                      <div key={allocation.symbol} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                        <div className="flex items-center justify-between">
                                          <p className="font-semibold text-gray-900">{allocation.symbol}</p>
                                          <p className="text-xs text-gray-500">{allocation.percent.toFixed(1)}%</p>
                                        </div>
                                        {quote?.error ? (
                                          <p className="mt-1 text-xs text-red-600">{quote.error}</p>
                                        ) : (
                                          <>
                                            <p className="mt-1 text-sm font-medium text-gray-800">
                                              {quote?.price !== undefined ? formatCurrency(quote.price) : "N/A"}
                                            </p>
                                            <p className={`text-xs ${windowChange !== undefined && windowChange < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                              {windowChange !== undefined
                                                ? `${windowChange >= 0 ? "+" : ""}${windowChange.toFixed(2)}% ${MARKET_WINDOW_SUFFIX[selectedMarketWindow]}`
                                                : "No change data"}
                                            </p>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                          ) : (
                            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                              <p className="text-sm font-semibold text-gray-800">Fixed Return Snapshot</p>
                              <p className="mt-1 text-xs text-gray-500">
                                Using nominal APR of {Number.isFinite(Number(config.fixedApr)) ? Number(config.fixedApr).toFixed(2) : "0.00"}%.
                              </p>
                              <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                                <p className="text-gray-500">Effective APY Used</p>
                                <p className="mt-1 font-semibold text-gray-900">
                                  {annualizedReturnUsedPct.toFixed(2)}%
                                </p>
                              </div>
                            </div>
                          )}

                          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">Historical Return Projection</p>
                                <p className="mt-1 text-xs text-gray-500">
                                  {isMarketTracking
                                    ? "Uses rolling monthly historical return paths from your allocation mix."
                                    : "Uses fixed monthly return derived from your APR setting."}
                                </p>
                                <p className="mt-1 text-xs text-gray-500">
                                  Model: {MONTE_CARLO_DISPLAY_RUNS.toLocaleString("en-US")} Monte Carlo runs, {MONTE_CARLO_BLOCK_SIZE}-month block bootstrap.
                                </p>
                                {isMarketTracking ? (
                                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    <div>
                                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Benchmark</p>
                                      <input
                                        className="app-input w-full"
                                        value={config.benchmarkSymbol}
                                        onChange={(event) =>
                                          setPlannerConfigs((current) => ({
                                            ...current,
                                            [goal.id]: {
                                              ...config,
                                              benchmarkSymbol: event.target.value.toUpperCase(),
                                            },
                                          }))
                                        }
                                        placeholder="SPY"
                                      />
                                    </div>
                                    <div>
                                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Risk-Free Rate (%)</p>
                                      <input
                                        className="app-input w-full"
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={config.riskFreeRate}
                                        onChange={(event) =>
                                          setPlannerConfigs((current) => ({
                                            ...current,
                                            [goal.id]: { ...config, riskFreeRate: event.target.value },
                                          }))
                                        }
                                        placeholder="2.0"
                                      />
                                    </div>
                                  </div>
                                ) : null}
                                <div className="mt-2 flex items-center gap-2">
                                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${projectionStatus.toneClass}`}>
                                    {projectionStatus.label}
                                  </span>
                                  <span className="text-xs text-gray-600">{projectionStatus.message}</span>
                                </div>
                              </div>
                              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
                                {RETURN_LOOKBACK_WINDOWS.map((windowKey) => (
                                  <button
                                    key={`${goal.id}-lookback-${windowKey}`}
                                    className={`px-2 py-1 text-xs font-medium ${
                                      selectedReturnLookback === windowKey
                                        ? "bg-slate-900 text-white"
                                        : "bg-white text-gray-600 hover:bg-gray-50"
                                    }`}
                                    onClick={() =>
                                      setPlannerReturnLookbackByGoal((current) => ({
                                        ...current,
                                        [goal.id]: windowKey,
                                      }))
                                    }
                                  >
                                    {windowKey}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {summary.monthsToGoal === 0 ? (
                              <p className="mt-2 text-sm text-gray-500">Set a future target date to calculate projected final value.</p>
                            ) : portfolioMonthlyReturns.length === 0 ? (
                              <p className="mt-2 text-sm text-amber-700">Not enough monthly history to run confidence scenarios for this allocation yet.</p>
                            ) : (
                              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <div>
                                  <p className="text-xs text-gray-500">Return Window Used</p>
                                  <p className="text-sm font-semibold text-gray-900">{selectedReturnLookback}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500">Avg Monthly Return Used</p>
                                  <p className={`text-sm font-semibold ${averageMonthlyReturnPct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                    {averageMonthlyReturnPct >= 0 ? "+" : ""}
                                    {averageMonthlyReturnPct.toFixed(2)}%
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500">
                                    {isMarketTracking ? "Annualized Return Used" : "Effective APY Used"}
                                  </p>
                                  <p className={`text-sm font-semibold ${annualizedReturnUsedPct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                    {annualizedReturnUsedPct >= 0 ? "+" : ""}
                                    {annualizedReturnUsedPct.toFixed(2)}%
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500">Planning Mode</p>
                                  <p className="text-sm font-semibold text-gray-900">
                                    {config.planMode === "contribution" ? "Monthly Contribution" : "Confidence Target"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500">Chance To Hit Target</p>
                                  <p className={`text-sm font-semibold ${activeHitProbability < targetConfidenceProbability ? "text-amber-700" : "text-emerald-600"}`}>
                                    {(activeHitProbability * 100).toFixed(1)}%
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500">Required / Month (Confidence)</p>
                                  <p className="text-sm font-semibold text-gray-900">
                                    {formatCurrency(confidenceRequiredMonthlyContribution)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500">Median Final Value (P50)</p>
                                  <p className="text-sm font-semibold text-gray-900">
                                    {formatCurrency(profileFinalP50)}
                                  </p>
                                </div>
                                {isRetirementGoal ? (
                                  <>
                                    <div>
                                      <p className="text-xs text-gray-500">Gross Retirement Income / Year</p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {formatCurrency(projectedGrossRetirementIncome)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-500">After-Tax Income / Month</p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {formatCurrency(projectedAfterTaxMonthlyIncome)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-500">Spend Goal Gap (After Tax)</p>
                                      <p className={`text-sm font-semibold ${retirementIncomeGap < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                        {retirementIncomeGap >= 0 ? "+" : ""}
                                        {formatCurrency(retirementIncomeGap)}
                                      </p>
                                    </div>
                                  </>
                                ) : null}
                              </div>
                            )}
                            {isMarketTracking ? (
                              <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/50 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">Risk Assessment</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      Benchmark-relative stats using overlapping monthly returns versus {benchmarkSymbol}.
                                    </p>
                                  </div>
                                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-sky-100">
                                    {riskMetrics.overlapCount} months aligned
                                  </span>
                                </div>
                                {riskMetrics.overlapCount < 2 ? (
                                  <p className="mt-3 text-sm text-amber-700">
                                    Not enough overlapping monthly data with {benchmarkSymbol} yet to calculate Beta, volatility, Sharpe, Sortino, and Information Ratio.
                                  </p>
                                ) : (
                                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                                    <button
                                      type="button"
                                      className="rounded-xl border border-white/80 bg-white px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                                      onClick={() =>
                                        setPlannerRiskInfoOpenByGoal((current) => ({
                                          ...current,
                                          [goal.id]: current[goal.id] === "beta" ? null : "beta",
                                        }))
                                      }
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <p className="text-xs text-gray-500">Beta vs {benchmarkSymbol}</p>
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="10" cy="10" r="7" />
                                            <path d="M10 8v5" />
                                            <path d="M10 5.5h.01" strokeLinecap="round" />
                                          </svg>
                                        </span>
                                      </div>
                                      <p className="mt-1 text-sm font-semibold text-gray-900">
                                        {riskMetrics.beta !== null ? riskMetrics.beta.toFixed(2) : "N/A"}
                                      </p>
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-xl border border-white/80 bg-white px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                                      onClick={() =>
                                        setPlannerRiskInfoOpenByGoal((current) => ({
                                          ...current,
                                          [goal.id]: current[goal.id] === "std_dev" ? null : "std_dev",
                                        }))
                                      }
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <p className="text-xs text-gray-500">Std Dev (Annualized)</p>
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="10" cy="10" r="7" />
                                            <path d="M10 8v5" />
                                            <path d="M10 5.5h.01" strokeLinecap="round" />
                                          </svg>
                                        </span>
                                      </div>
                                      <p className="mt-1 text-sm font-semibold text-gray-900">
                                        {riskMetrics.annualizedStdDevPct !== null
                                          ? `${riskMetrics.annualizedStdDevPct.toFixed(2)}%`
                                          : "N/A"}
                                      </p>
                                      <p className="mt-1 text-[11px] text-gray-500">
                                        Monthly: {riskMetrics.monthlyStdDevPct !== null ? `${riskMetrics.monthlyStdDevPct.toFixed(2)}%` : "N/A"}
                                      </p>
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-xl border border-white/80 bg-white px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                                      onClick={() =>
                                        setPlannerRiskInfoOpenByGoal((current) => ({
                                          ...current,
                                          [goal.id]: current[goal.id] === "sharpe" ? null : "sharpe",
                                        }))
                                      }
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <p className="text-xs text-gray-500">Sharpe Ratio</p>
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="10" cy="10" r="7" />
                                            <path d="M10 8v5" />
                                            <path d="M10 5.5h.01" strokeLinecap="round" />
                                          </svg>
                                        </span>
                                      </div>
                                      <p className="mt-1 text-sm font-semibold text-gray-900">
                                        {riskMetrics.sharpeRatio !== null ? riskMetrics.sharpeRatio.toFixed(2) : "N/A"}
                                      </p>
                                      <p className="mt-1 text-[11px] text-gray-500">
                                        Uses {riskFreeRatePct.toFixed(1)}% risk-free rate.
                                      </p>
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-xl border border-white/80 bg-white px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                                      onClick={() =>
                                        setPlannerRiskInfoOpenByGoal((current) => ({
                                          ...current,
                                          [goal.id]: current[goal.id] === "sortino" ? null : "sortino",
                                        }))
                                      }
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <p className="text-xs text-gray-500">Sortino Ratio</p>
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="10" cy="10" r="7" />
                                            <path d="M10 8v5" />
                                            <path d="M10 5.5h.01" strokeLinecap="round" />
                                          </svg>
                                        </span>
                                      </div>
                                      <p className="mt-1 text-sm font-semibold text-gray-900">
                                        {riskMetrics.sortinoRatio !== null ? riskMetrics.sortinoRatio.toFixed(2) : "N/A"}
                                      </p>
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-xl border border-white/80 bg-white px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                                      onClick={() =>
                                        setPlannerRiskInfoOpenByGoal((current) => ({
                                          ...current,
                                          [goal.id]: current[goal.id] === "information" ? null : "information",
                                        }))
                                      }
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <p className="text-xs text-gray-500">Info Ratio vs {benchmarkSymbol}</p>
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="10" cy="10" r="7" />
                                            <path d="M10 8v5" />
                                            <path d="M10 5.5h.01" strokeLinecap="round" />
                                          </svg>
                                        </span>
                                      </div>
                                      <p className="mt-1 text-sm font-semibold text-gray-900">
                                        {riskMetrics.informationRatio !== null ? riskMetrics.informationRatio.toFixed(2) : "N/A"}
                                      </p>
                                      <p className="mt-1 text-[11px] text-gray-500">
                                        Benchmark-relative risk-adjusted excess return.
                                      </p>
                                    </button>
                                  </div>
                                )}
                                {activeRiskInfo !== null ? (
                                  <div className="mt-3 rounded-xl border border-sky-100 bg-white px-4 py-3 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-semibold text-slate-900">
                                          {RISK_INFO_COPY[activeRiskInfo].title}
                                        </p>
                                        <p className="mt-1 text-sm text-slate-600">
                                          {RISK_INFO_COPY[activeRiskInfo].definition}
                                        </p>
                                        <p className="mt-2 text-sm text-slate-600">
                                          <span className="font-semibold text-slate-800">How to read it:</span>{" "}
                                          {RISK_INFO_COPY[activeRiskInfo].read}
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                                        onClick={() =>
                                          setPlannerRiskInfoOpenByGoal((current) => ({
                                            ...current,
                                            [goal.id]: null,
                                          }))
                                        }
                                      >
                                        Close
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {portfolioMonthlyReturns.length > 0 ? (
                              <div className="mt-3 grid gap-3 text-xs text-gray-600 md:grid-cols-3">
                                <p>P25 final: <span className="font-medium text-gray-800">{formatCurrency(profileFinalP25)}</span></p>
                                <p>P75 final: <span className="font-medium text-gray-800">{formatCurrency(profileFinalP75)}</span></p>
                                <p>{selectedReturnLookback} history coverage: <span className="font-medium text-gray-800">{monthlyCoveragePercent.toFixed(0)}%</span></p>
                              </div>
                            ) : null}
                            {summary.monthsToGoal > 0 ? (
                              <GrowthComparisonChart
                                baseTrajectory={baseGrowthTrajectory}
                                medianTrajectory={returnGrowthTrajectories.p50}
                                lowerTrajectory={returnGrowthTrajectories.p25}
                                upperTrajectory={returnGrowthTrajectories.p75}
                                startMonthKey={projectionStartMonthKey}
                              />
                            ) : null}
                            {effectiveAnnualCoveragePercent < 99.9 && effectiveAnnualCoveragePercent > 0 ? (
                              <p className="mt-2 text-xs text-amber-700">
                                Note: 1Y return data only covers {effectiveAnnualCoveragePercent.toFixed(1)}% of your allocation weights.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded-2xl border border-dashed border-slate-300/80 bg-white/90 p-5 shadow-sm">
              <p className="font-semibold text-gray-800">Next step (API/AI integration)</p>
              <p className="mt-1 text-sm text-gray-500">
                This planner is now connected to your existing goals. Next we can plug in daily market data and run confidence bands for low/balanced/high risk scenarios.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

