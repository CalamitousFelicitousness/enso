import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRunBenchmark, useBenchmarkResults } from "@/api/hooks/useSystem";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { toast } from "sonner";
import { Section, Row } from "../shared";

const LEVELS = [
  { value: "quick", label: "Quick (batch 1)" },
  { value: "normal", label: "Normal (batch 1,2,4)" },
  { value: "extensive", label: "Extensive (batch 1-16)" },
];

const STEPS = [
  { value: "turbo", label: "Turbo (10 steps)" },
  { value: "normal", label: "Normal (20 steps)" },
  { value: "long", label: "Long (50 steps)" },
];

export function BenchmarkSubTab() {
  const runBenchmark = useRunBenchmark();
  const {
    data: history,
    refetch: loadHistory,
    isFetching: historyLoading,
  } = useBenchmarkResults();

  const [level, setLevel] = useState("quick");
  const [steps, setSteps] = useState("normal");
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);

  const historyCols = useMemo(() => {
    const headers = history?.headers ?? [];
    return {
      timestamp: headers.indexOf("timestamp"),
      its: headers.indexOf("it/s"),
      gpu: headers.indexOf("gpu"),
    };
  }, [history?.headers]);

  function handleRun() {
    runBenchmark.mutate(
      { level, steps, width, height },
      {
        onError: (err) => {
          toast.error("Benchmark failed", {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <Section title="Settings">
        <div className="space-y-2">
          <div>
            <Label className="text-xs mb-1 block">Level</Label>
            <Combobox
              options={LEVELS}
              value={level}
              onValueChange={setLevel}
              placeholder="Select level"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Steps</Label>
            <Combobox
              options={STEPS}
              value={steps}
              onValueChange={setSteps}
              placeholder="Select steps"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs mb-1 block">Width</Label>
              <NumberInput
                value={width}
                onChange={setWidth}
                min={64}
                max={4096}
                step={64}
                fallback={512}
                className="h-6 text-2xs"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Height</Label>
              <NumberInput
                value={height}
                onChange={setHeight}
                min={64}
                max={4096}
                step={64}
                fallback={512}
                className="h-6 text-2xs"
              />
            </div>
          </div>
        </div>
      </Section>

      <Button
        size="sm"
        onClick={handleRun}
        disabled={runBenchmark.isPending}
        className="w-full"
      >
        {runBenchmark.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
        ) : null}
        Run benchmark
      </Button>

      {runBenchmark.data && (
        <Section title="Results">
          {runBenchmark.data.error && (
            <p className="text-xs text-destructive">
              {runBenchmark.data.error}
            </p>
          )}
          <div className="space-y-0.5">
            <div className="grid grid-cols-2 gap-2 text-3xs font-medium text-muted-foreground px-2 pb-1 border-b border-border">
              <span>Batch Size</span>
              <span className="text-right">it/s</span>
            </div>
            {runBenchmark.data.results.map((r) => (
              <div
                key={r.batch}
                className="grid grid-cols-2 gap-2 text-xs px-2 py-0.5"
              >
                <span>{r.batch}</span>
                <span className="text-right font-mono tabular-nums font-medium">
                  {typeof r.its === "number" ? r.its.toFixed(2) : r.its}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="border-t border-border pt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void loadHistory()}
          disabled={historyLoading}
          className="w-full"
        >
          {historyLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : null}
          Load previous results
        </Button>

        {history && history.data.length > 0 && (
          <div className="mt-3 space-y-1">
            <h4 className="text-xs font-medium text-muted-foreground">
              History
            </h4>
            {history.data.map((row, i) => {
              const ts = historyCols.timestamp >= 0 ? row[historyCols.timestamp] : null;
              if (!ts) return null;
              return (
                <div
                  key={`${ts}-${i}`}
                  className="text-3xs p-1.5 rounded bg-muted space-y-0.5"
                >
                  <Row label="Timestamp" value={ts} />
                  {historyCols.its >= 0 && (
                    <Row label="Performance" value={row[historyCols.its]} />
                  )}
                  {historyCols.gpu >= 0 && (
                    <Row label="GPU" value={row[historyCols.gpu]} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
