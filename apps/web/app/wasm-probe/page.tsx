import { TimeSeriesProbe } from "@/components/wasm/time-series-probe";

export default function WasmProbePage() {
  return (
    <main className="flex min-h-screen justify-center px-6 py-16">
      <TimeSeriesProbe />
    </main>
  );
}
