import type { YearlyAveragePricePoint } from "@/lib/analysis/results";

import {
  formatCount,
  formatPercentage,
  formatPrice,
  getYearOverYearChange,
} from "./formatters";

type AccessibleDataTableProps = {
  readonly points: readonly YearlyAveragePricePoint[];
};

export function AccessibleDataTable({ points }: AccessibleDataTableProps) {
  return (
    <details className="border-t pt-4">
      <summary className="w-fit cursor-pointer select-none text-sm font-medium">
        View exact values
      </summary>

      <table className="mt-4 w-full border-collapse text-left text-sm tabular-nums">
        <caption className="sr-only">
          Average property price and transaction count for every year in the
          analysis
        </caption>
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-2 font-medium" scope="col">
              Year
            </th>
            <th className="px-2 py-2 text-right font-medium" scope="col">
              Average
            </th>
            <th className="px-2 py-2 text-right font-medium" scope="col">
              Sales
            </th>
            <th className="py-2 pl-2 text-right font-medium" scope="col">
              YoY
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => {
            const change = getYearOverYearChange(points, index);

            return (
              <tr className="border-b last:border-0" key={point.year}>
                <th className="py-2 pr-2 font-medium" scope="row">
                  {point.year}
                </th>
                <td className="px-2 py-2 text-right">
                  {formatPrice(point.averagePrice)}
                </td>
                <td className="px-2 py-2 text-right">
                  {formatCount(point.transactionCount)}
                </td>
                <td className="py-2 pl-2 text-right">
                  {change === null ? "—" : formatPercentage(change)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
