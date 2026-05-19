import { useGpuStatus, useMemory, useLoadedModels, useServerInfo } from "@/api/hooks/useServer";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { GroupedModels } from "@/components/layout/LoadedModelsPanel";
import { formatBytes } from "@/lib/utils";
import { Section, Row, BarRow } from "../shared";

export function OverviewSubTab() {
  const visible = useKeepAliveVisible();
  const { data: gpus } = useGpuStatus(visible);
  const { data: memory } = useMemory(visible);
  const { data: models } = useLoadedModels(visible);
  const { data: serverInfo } = useServerInfo();

  const gpu = gpus?.[0];
  const metrics = gpu?.metrics;

  const vramAllocated = memory?.cuda?.allocated?.current;
  const vramTotal = memory?.cuda?.system?.total;
  const ramUsed = memory?.ram?.used;
  const ramTotal = memory?.ram?.total;

  return (
    <div className="space-y-4">
      {gpu && (
        <Section title="GPU">
          <Row label="Name" value={gpu.name} />
          {metrics?.temperature != null && (
            <BarRow label="Temp" value={metrics.temperature} max={100} unit="C" />
          )}
          {metrics?.load_gpu != null && (
            <BarRow label="GPU Load" value={metrics.load_gpu} max={100} unit="%" />
          )}
          {metrics?.load_vram != null && (
            <BarRow label="VRAM Load" value={metrics.load_vram} max={100} unit="%" />
          )}
          {metrics?.fan_speed != null && <Row label="Fan" value={`${metrics.fan_speed}%`} />}
          {metrics?.power_current != null && metrics?.power_limit != null && (
            <Row label="Power" value={`${metrics.power_current}W / ${metrics.power_limit}W`} />
          )}
        </Section>
      )}

      <Section title="Memory">
        {vramAllocated != null && vramTotal != null && vramTotal > 0 && (
          <BarRow label="VRAM" value={vramAllocated} max={vramTotal} formatter={formatBytes} />
        )}
        {ramUsed != null && ramTotal != null && ramTotal > 0 && (
          <BarRow label="RAM" value={ramUsed} max={ramTotal} formatter={formatBytes} />
        )}
        {!vramTotal && !ramTotal && <p className="text-xs text-muted-foreground">No memory data</p>}
      </Section>

      <Section title={`Loaded Models (${models?.length ?? 0})`}>
        {models && models.length > 0 ? (
          <GroupedModels models={models} />
        ) : (
          <p className="text-xs text-muted-foreground">No models loaded</p>
        )}
      </Section>

      {serverInfo && (
        <Section title="Server">
          <Row label="Version" value={serverInfo.version.app ?? ""} />

          <Row label="Backend" value={serverInfo.backend} />
          <Row label="Platform" value={serverInfo.platform} />
        </Section>
      )}
    </div>
  );
}
