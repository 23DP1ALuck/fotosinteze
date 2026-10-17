function toPoints(values: number[], width: number, height: number) {
  const max = 100
  const min = 20
  const range = max - min
  const step = width / (values.length - 1)

  return values.map((value, index) => ({
    x: index * step,
    y: height - ((value - min) / range) * height,
  }))
}

function toSmoothPath(values: number[], width: number, height: number) {
  const points = toPoints(values, width, height)
  if (points.length === 0) return ''

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i === 0 ? i : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

const revenue = [38, 42, 40, 48, 72, 68, 78, 70, 76, 84, 82, 92]
const expenses = [36, 40, 41, 44, 48, 50, 49, 52, 51, 58, 62, 68]
const chartWidth = 560
const chartHeight = 168
const revenuePath = toSmoothPath(revenue, chartWidth, chartHeight)
const expensesPath = toSmoothPath(expenses, chartWidth, chartHeight)
const areaPath = `${revenuePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`

const budgets = [
  {
    name: 'Marketing',
    spent: '€2,340',
    total: '€3,000',
    progress: 78,
    remaining: '€660 left to put your plans in motion.',
  },
  { name: 'Software', spent: '€780', total: '€1,500', progress: 52 },
  { name: 'Travel', spent: '€420', total: '€2,000', progress: 21 },
]

function HeroPreview() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-[0_28px_80px_-28px_rgba(26,60,52,0.22)]">
      <div className="flex items-center justify-between gap-4 border-b border-[#eeeae0] px-5 py-4 sm:px-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#f3f2ea] px-3 py-1.5 text-sm text-[#1a2e2a]">
          <span className="size-1.5 rounded-full bg-[#1a3c34]" aria-hidden />
          Acme Studio
          <span className="text-[#9aa19c]">/</span>
          <span>Business</span>
          <span className="text-[10px] text-[#9aa19c]" aria-hidden>
            ▾
          </span>
        </div>
        <nav className="hidden items-center gap-6 text-sm text-[#8b928c] md:flex" aria-label="Workspace">
          <span className="font-medium text-[#1a2e2a]">Overview</span>
          <span>Transactions</span>
          <span>Budgets</span>
          <span>Team</span>
        </nav>
        <p className="hidden text-sm text-[#8b928c] sm:block">September 2026</p>
      </div>

      <div className="space-y-5 px-5 py-6 sm:px-6">
        <h2 className="m-0 text-[1.65rem] font-medium tracking-tight text-[#1a2e2a]">
          A little clarity goes a long way.
        </h2>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[#f3f2ea] px-5 py-4">
            <p className="text-sm text-[#7d847e]">Total revenue</p>
            <p className="mt-2 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              €12,450.00
            </p>
          </div>
          <div className="rounded-2xl bg-[#f3f2ea] px-5 py-4">
            <p className="text-sm text-[#7d847e]">Total expenses</p>
            <p className="mt-2 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              €7,820.00
            </p>
          </div>
          <div className="rounded-2xl bg-[#d8ee63] px-5 py-4">
            <p className="text-sm text-[#3d4a28]">Net profit · 37.2% margin</p>
            <p className="mt-2 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              €4,630.00
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="rounded-2xl border border-[#f0eee6] px-5 py-4">
            <p className="text-lg font-medium tracking-tight text-[#1a2e2a]">
              Money in. Money out.
            </p>
            <div className="mt-3 flex items-center gap-4 text-xs text-[#7d847e]">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#1a3c34]" />
                Revenue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#c5c07a]" />
                Expenses
              </span>
            </div>
            <div className="mt-4" aria-hidden>
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="h-40 w-full overflow-visible sm:h-44"
                preserveAspectRatio="none"
              >
                {[0.25, 0.5, 0.75].map((line) => (
                  <line
                    key={line}
                    x1="0"
                    x2={chartWidth}
                    y1={chartHeight * line}
                    y2={chartHeight * line}
                    stroke="#ece9df"
                    strokeWidth="1"
                  />
                ))}
                <path d={areaPath} fill="#1a3c34" opacity="0.08" />
                <path
                  d={revenuePath}
                  fill="none"
                  stroke="#1a3c34"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={expensesPath}
                  fill="none"
                  stroke="#b7b36a"
                  strokeWidth="2"
                  strokeDasharray="5 6"
                  strokeLinecap="round"
                />
              </svg>
              <div className="mt-2 flex justify-between text-[11px] tracking-wide text-[#9aa19c] uppercase">
                <span>Jun</span>
                <span>Jul</span>
                <span>Aug</span>
                <span>Sep</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#f3f2ea] px-5 py-4">
            <p className="text-lg font-medium tracking-tight text-[#1a2e2a]">
              Every budget, in view.
            </p>
            <ul className="mt-5 space-y-4">
              {budgets.map((budget) => (
                <li key={budget.name}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-[#1a2e2a]">{budget.name}</span>
                    <span className="text-[#7d847e]">
                      {budget.spent} / {budget.total}
                    </span>
                  </div>
                  {budget.remaining ? (
                    <>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4e2d8]">
                        <div
                          className="h-full rounded-full bg-[#1a3c34]"
                          style={{ width: `${budget.progress}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-[#8b928c]">{budget.remaining}</p>
                    </>
                  ) : (
                    <div className="mt-3 h-px bg-[#e6e3d8]" />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export { HeroPreview }
