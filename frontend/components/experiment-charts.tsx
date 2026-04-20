"use client"

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

interface MetricsTrendData {
  name: string
  iteration: number
  auto_rate: number
  review_per_image: number
  time_per_image: number
  map50: number | null
}

interface MetricsTrendGridProps {
  data: MetricsTrendData[]
}

const metrics = [
  { key: "auto_rate", label: "Automation Rate", unit: "%", color: "#22c55e", domain: [0, 100] },
  { key: "review_per_image", label: "Review/Image", unit: "", color: "#3b82f6", domain: undefined },
  { key: "time_per_image", label: "Time/Image", unit: "s", color: "#f59e0b", domain: undefined },
  { key: "map50", label: "mAP@0.5", unit: "%", color: "#8b5cf6", domain: [0, 100] },
] as const

function SmallChart({ 
  data, 
  dataKey, 
  label, 
  unit, 
  color, 
  domain 
}: { 
  data: MetricsTrendData[]
  dataKey: string
  label: string
  unit: string
  color: string
  domain: [number, number] | undefined
}) {
  const formatValue = (v: number) => {
    if (v === null) return "-"
    if (unit === "%") return `${v.toFixed(1)}%`
    if (unit === "s") return `${v.toFixed(1)}s`
    return v.toFixed(2)
  }

  return (
    <div>
      <div className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </div>
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis 
              tick={{ fontSize: 11 }} 
              tickLine={false} 
              axisLine={false}
              domain={domain || ["auto", "auto"]}
              tickFormatter={(v) => unit === "%" ? `${v}` : String(v)}
              width={35}
            />
            <Tooltip 
              formatter={(value: number) => [formatValue(value), label]}
              contentStyle={{ fontSize: 12 }}
            />
            <Line 
              type="monotone" 
              dataKey={dataKey} 
              stroke={color}
              strokeWidth={2}
              dot={{ fill: color, strokeWidth: 0, r: 4 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function MetricsTrendGrid({ data }: MetricsTrendGridProps) {
  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-muted-foreground">
        No iteration data yet
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      {metrics.map((metric) => (
        <SmallChart
          key={metric.key}
          data={data}
          dataKey={metric.key}
          label={metric.label}
          unit={metric.unit}
          color={metric.color}
          domain={metric.domain as [number, number] | undefined}
        />
      ))}
    </div>
  )
}

interface SourceDistributionChartProps {
  data: Array<{
    name: string
    iteration: number
    autoApproved: number
    userModified: number
    userAdded: number
    autoApprovedRaw: number
    userModifiedRaw: number
    userAddedRaw: number
    total: number
  }>
}

export function SourceDistributionChart({ data }: SourceDistributionChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 60, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} />
        <Tooltip
          formatter={(
            value: number,
            name: string,
            props: { payload: { autoApprovedRaw: number; userModifiedRaw: number; userAddedRaw: number; total: number } }
          ) => {
            const raw =
              name === "autoApproved"
                ? props.payload.autoApprovedRaw
                : name === "userModified"
                  ? props.payload.userModifiedRaw
                  : props.payload.userAddedRaw
            return [
              `${value.toFixed(1)}% (${raw}/${props.payload.total})`,
              name === "autoApproved" ? "Auto Approved" : name === "userModified" ? "User Modified" : "User Added",
            ]
          }}
        />
        <Legend
          formatter={(value) =>
            value === "autoApproved" ? "Auto Approved" : value === "userModified" ? "User Modified" : "User Added"
          }
        />
        <Bar dataKey="autoApproved" stackId="a" fill="#22c55e" name="autoApproved" />
        <Bar dataKey="userModified" stackId="a" fill="#eab308" name="userModified" />
        <Bar dataKey="userAdded" stackId="a" fill="#3b82f6" name="userAdded" />
      </BarChart>
    </ResponsiveContainer>
  )
}
