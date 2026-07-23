"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Database,
  HardDrive,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Waypoints,
  X,
} from "lucide-react";

import {
  activateDataSourceSession,
  discoverDataSourceTables,
  fetchDataSources,
  inspectDataSource,
  selectRegisteredDataSource,
  startDataSourceRegistration,
  subscribeToDataSourceRegistration,
  type DataSourceClientError,
} from "@/lib/data-sources/client";
import type {
  DataSourceSummary,
  DataSourceDiscovery,
  InspectedRelation,
  RegistrationSnapshot,
} from "@/lib/data-sources/contracts";

type DataSourceManagerProps = {
  readonly initialAdding?: boolean;
  readonly onCancel?: () => void;
  readonly onDatasetChanged: (source: DataSourceSummary) => void;
};

type FormState = {
  readonly slug: string;
  readonly displayName: string;
  readonly database: string;
  readonly table: string;
  readonly mappingSql: string;
};

const INITIAL_FORM: FormState = {
  slug: "",
  displayName: "",
  database: "default",
  table: "",
  mappingSql: "",
};

function semanticKey(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const prefixed = /^[a-z]/.test(normalized)
    ? normalized
    : `field_${normalized}`;
  return prefixed.slice(0, 64);
}

function mappingTemplate(relation: InspectedRelation): string {
  const temporal = relation.columns.find((column) =>
    /\bDate(?:Time)?(?:32|64)?\b/i.test(column.type),
  );
  const numeric = relation.columns
    .filter(
      (column) =>
        /\b(?:U?Int\d*|Float\d*|Decimal)\b/i.test(column.type) &&
        !/^Nullable\(/i.test(column.type) &&
        !/(?:^|_)(?:id|year|month|day|type|status|code|flag)(?:_|$)|^is_/i.test(
          column.name,
        ) &&
        !/(?:longitude|latitude|coordinate)/i.test(column.name),
    )
    .slice(0, 4);
  const dimensions = relation.columns
    .filter(
      (column) =>
        /\b(?:String|Enum|Bool)\b/i.test(column.type) ||
        /(?:^|_)(?:type|status|code|flag)(?:_|$)|^is_/i.test(column.name),
    )
    .filter((column) => column.name !== temporal?.name)
    .slice(0, 6);
  const selected = [
    ...(temporal === undefined
      ? []
      : [
          {
            expression: `toDate(${temporal.name})`,
            alias: semanticKey(temporal.name),
          },
        ]),
    ...numeric.map((column) => ({
      expression: `toFloat64(${column.name})`,
      alias: semanticKey(column.name),
    })),
    ...dimensions.map((column) => ({
      expression: `toString(${column.name})`,
      alias: semanticKey(column.name),
    })),
  ];
  const unique = selected.filter(
    (entry, index) =>
      selected.findIndex((candidate) => candidate.alias === entry.alias) ===
      index,
  );
  const projections = unique
    .map(({ expression, alias }) => `  ${expression} AS ${alias}`)
    .join(",\n");

  return `SELECT\n${projections}\nFROM ${relation.database}.${relation.table}`;
}

function formatRows(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function displayName(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function datasetSlug(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const prefixed = /^[a-z]/.test(normalized)
    ? normalized
    : `source_${normalized}`;
  return prefixed === "uk_price_paid" ? `${prefixed}_source` : prefixed.slice(0, 48);
}

export function DataSourceManager({
  initialAdding = false,
  onCancel,
  onDatasetChanged,
}: DataSourceManagerProps) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(initialAdding);
  const [adminToken, setAdminToken] = useState("");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [inspection, setInspection] = useState<InspectedRelation | null>(null);
  const [snapshot, setSnapshot] = useState<RegistrationSnapshot | null>(null);
  const [clientError, setClientError] = useState<DataSourceClientError | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const sourcesQuery = useQuery({
    queryKey: ["data-sources"],
    queryFn: async () => await fetchDataSources(),
    staleTime: 10_000,
    retry: false,
  });
  const registry =
    sourcesQuery.data?.isOk() === true ? sourcesQuery.data.value : null;
  const registryError =
    sourcesQuery.data?.isErr() === true ? sourcesQuery.data.error : null;
  const discoveryQuery = useQuery({
    queryKey: ["data-source-discovery"],
    queryFn: async () => await discoverDataSourceTables(),
    staleTime: 10_000,
    retry: false,
  });
  const discovery =
    discoveryQuery.data?.isOk() === true ? discoveryQuery.data.value : null;
  const discoveryError =
    discoveryQuery.data?.isErr() === true ? discoveryQuery.data.error : null;

  const inspectMutation = useMutation({
    mutationFn: async (
      table: DataSourceDiscovery["tables"][number],
    ) => await inspectDataSource(table.database, table.table, adminToken),
    onSuccess: (result, table) => {
      if (result.isErr()) {
        setClientError(result.error);
        return;
      }

      setInspection(result.value);
      setForm((current) => ({
        ...current,
        database: table.database,
        table: table.table,
        displayName: displayName(table.table),
        slug: datasetSlug(table.table),
        mappingSql: mappingTemplate(result.value),
      }));
      setClientError(null);
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async () => await activateDataSourceSession(adminToken),
    onSuccess: async (result) => {
      if (result.isErr()) {
        setClientError(result.error);
        return;
      }

      setClientError(null);
      await queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      await queryClient.invalidateQueries({
        queryKey: ["data-source-discovery"],
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () =>
      await startDataSourceRegistration({
        slug: form.slug,
        displayName: form.displayName,
        database: form.database,
        table: form.table,
        mappingSql: form.mappingSql,
      }, adminToken),
    onSuccess: (result) => {
      if (result.isErr()) {
        setClientError(result.error);
        return;
      }

      setRunId(result.value.runId);
      setClientError(null);
    },
  });

  const selectMutation = useMutation({
    mutationFn: async (slug: string) =>
      await selectRegisteredDataSource(slug, adminToken),
    onSuccess: async (result) => {
      if (result.isErr()) {
        setClientError(result.error);
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      onDatasetChanged(result.value);
    },
  });

  useEffect(() => {
    if (runId === null) {
      return;
    }

    return subscribeToDataSourceRegistration(
      runId,
      (nextSnapshot) => {
        setSnapshot(nextSnapshot);

        if (
          nextSnapshot.status === "completed" &&
          nextSnapshot.result?.status === "compatible"
        ) {
          void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
        }
      },
      setClientError,
    );
  }, [queryClient, runId]);

  const phaseLabel = useMemo(() => {
    const phase = snapshot?.metadata?.phase;
    return phase === undefined
      ? "Preparing validation"
      : phase.replaceAll("_", " ");
  }, [snapshot]);

  function updateForm(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function closeForm() {
    if (onCancel !== undefined) {
      onCancel();
      return;
    }

    setAdding(false);
    setForm(INITIAL_FORM);
    setInspection(null);
    setSnapshot(null);
    setRunId(null);
    setClientError(null);
  }

  function chooseTable(
    table: DataSourceDiscovery["tables"][number],
  ) {
    if (table.registered !== null) {
      const registered = registry?.sources.find(
        (source) =>
          source.slug === table.registered?.slug &&
          source.version === table.registered.version,
      );

      if (registered !== undefined) {
        onDatasetChanged(registered);
      }
      return;
    }

    inspectMutation.mutate(table);
  }

  if (adding) {
    const registrationComplete =
      snapshot?.status === "completed" &&
      snapshot.result?.status === "compatible";
    const registrationRejected =
      snapshot?.status === "completed" &&
      snapshot.result?.status === "incompatible";
    const registrationFailed = snapshot?.status === "failed";
    const isRegistering =
      runId !== null && snapshot?.status !== "completed" && snapshot?.status !== "failed";

    return (
      <div className="view-dashboard h-full overflow-hidden">
        <div className="analysis-bento h-full">
          <section className="analysis-tile col-span-12 flex min-h-0 flex-col p-5 lg:col-span-4">
            <button
              className="flex w-fit items-center gap-2 text-xs font-medium text-[#596983]"
              onClick={closeForm}
              type="button"
            >
              <ChevronLeft className="size-4" />
              Data sources
            </button>
            <p className="mt-6 text-xs font-medium text-[#176f6b]">01 · ClickHouse tables</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#09265b]">
              Choose a table
            </h2>
            <div className="soft-scrollbar mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {discoveryQuery.isLoading && (
                <div className="flex items-center gap-2 rounded-2xl bg-[#f4f7fb] p-4 text-xs text-[#66758e]">
                  <LoaderCircle className="size-4 animate-spin" />
                  Finding tables
                </div>
              )}
              {discovery?.tables.map((table) => (
                <button
                  className="flex w-full items-center gap-3 rounded-2xl border border-[#09265b]/7 bg-white/60 p-3 text-left transition-colors hover:bg-white"
                  key={`${table.database}.${table.table}`}
                  onClick={() => chooseTable(table)}
                  type="button"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f5c400]/12 text-[#8b7100]">
                    <HardDrive className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-[#09265b]">
                      {displayName(table.table)}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-[#66758e]">
                      {formatRows(table.estimatedRows)} rows · {table.columnCount} columns
                    </span>
                  </span>
                  <span className="rounded-full bg-[#eef4fb] px-2 py-1 text-[9px] font-semibold text-[#596983]">
                    {table.registered === null ? "Set up" : "Ready"}
                  </span>
                </button>
              ))}
              {discovery !== null && discovery.tables.length === 0 && (
                <p className="rounded-2xl bg-[#f4f7fb] p-4 text-xs text-[#66758e]">
                  No analytical tables were found.
                </p>
              )}
            </div>

            {discoveryError !== null && (
              <div className="mt-4">
                <p className="text-xs text-[#9f3948]">
                  {discoveryError.message}
                </p>
              </div>
            )}

            {(discoveryError !== null || registryError !== null) && (
              <div className="mt-4 grid gap-2">
              <label className="grid gap-1.5 text-xs text-[#66758e]">
                Workspace token
                <input
                  autoComplete="off"
                  className="rounded-xl border border-[#09265b]/10 bg-white/75 px-3 py-2.5 text-sm text-[#09265b] outline-none focus:border-[#1769df]/45"
                  onChange={(event) => setAdminToken(event.target.value)}
                  placeholder="Only required in production"
                  type="password"
                  value={adminToken}
                />
              </label>
                <button
                  className="rounded-xl bg-[#09265b] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
                  disabled={adminToken.length === 0 || unlockMutation.isPending}
                  onClick={() => unlockMutation.mutate()}
                  type="button"
                >
                  Unlock
                </button>
              </div>
            )}
          </section>

          <section className="analysis-tile col-span-12 flex min-h-0 flex-col overflow-hidden p-5 lg:col-span-8">
            {inspection === null ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <Database className="mx-auto size-8 text-[#1769df]" />
                  <h3 className="mt-4 text-lg font-semibold text-[#09265b]">
                    Select a table
                  </h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[#66758e]">
                    Lens will find its analytical roles and validate them before the source becomes available.
                  </p>
                </div>
              </div>
            ) : registrationComplete ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#21c5be]/12 text-[#16837e]">
                    <Check className="size-6" />
                  </span>
                  <h3 className="mt-5 text-2xl font-semibold text-[#09265b]">
                    Dataset is ready
                  </h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-[#66758e]">
                    Trigger.dev profiled the mapping, Rust verified its Arrow output, and PostgreSQL activated version {snapshot.result?.status === "compatible" ? snapshot.result.source.version : 1}.
                  </p>
                  <button
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#09265b] px-5 py-3 text-sm font-semibold text-white"
                    onClick={() => {
                      if (snapshot.result?.status === "compatible") {
                        selectMutation.mutate(snapshot.result.source.slug);
                      }
                    }}
                    type="button"
                  >
                    Start analysing
                    <ArrowRight className="size-4" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-[#885cf6]">02 · Analytical mapping</p>
                    <h3 className="mt-2 text-xl font-semibold text-[#09265b]">
                      Choose useful columns
                    </h3>
                  </div>
                  <span className="rounded-xl bg-[#eef4fb] px-3 py-2 text-xs text-[#596983]">
                    {inspection.columns.length} columns · {formatRows(inspection.estimatedRows)} rows
                  </span>
                </div>

                <div className="mt-4 flex min-h-0 flex-1 gap-4">
                  <div className="soft-scrollbar hidden w-44 shrink-0 overflow-y-auto rounded-2xl bg-[#f4f7fb] p-3 md:block">
                    {inspection.columns.map((column) => (
                      <div className="border-b border-[#09265b]/6 py-2 last:border-0" key={column.name}>
                        <p className="truncate font-mono text-xs text-[#09265b]">{column.name}</p>
                        <p className="mt-0.5 truncate text-[10px] text-[#8591a5]">{column.type}</p>
                      </div>
                    ))}
                  </div>
                  <textarea
                    aria-label="Mapping SQL"
                    className="soft-scrollbar min-h-0 flex-1 resize-none rounded-2xl border border-[#09265b]/9 bg-[#071a38] p-4 font-mono text-xs leading-6 text-[#d9e7ff] outline-none focus:border-[#21c5be]/60"
                    onChange={(event) => updateForm("mappingSql", event.target.value)}
                    spellCheck={false}
                    value={form.mappingSql}
                  />
                </div>

                {(isRegistering || registrationRejected || registrationFailed) && (
                  <div className="mt-4 rounded-2xl bg-[#f4f7fb] p-4">
                    <div className="flex items-center gap-3">
                      {registrationRejected || registrationFailed ? (
                        <X className="size-4 text-[#ff6372]" />
                      ) : (
                        <LoaderCircle className="size-4 animate-spin text-[#885cf6]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold capitalize text-[#09265b]">
                          {registrationRejected
                            ? "Mapping needs attention"
                            : registrationFailed
                              ? "Validation run failed"
                              : phaseLabel}
                        </p>
                        <div className="mt-2 h-1.5 rounded-full bg-[#dfe7f2]">
                          <div
                            className="h-full rounded-full bg-[#885cf6] transition-[width]"
                            style={{ width: `${(snapshot?.metadata?.progress ?? 0.05) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    {registrationRejected && snapshot.result?.status === "incompatible" && (
                      <p className="mt-3 text-xs leading-5 text-[#9f3948]">
                        {snapshot.result.message}
                      </p>
                    )}
                    {registrationFailed && (
                      <p className="mt-3 text-xs leading-5 text-[#9f3948]">
                        {snapshot.error ?? "Trigger.dev could not complete the validation run"}
                      </p>
                    )}
                  </div>
                )}

                {clientError !== null && (
                  <p className="mt-3 text-xs text-[#9f3948]">{clientError.message}</p>
                )}

                <button
                  className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#09265b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                  disabled={
                    isRegistering ||
                    registerMutation.isPending ||
                    form.slug.length < 3 ||
                    form.displayName.length < 3
                  }
                  onClick={() => registerMutation.mutate()}
                  type="button"
                >
                  <ShieldCheck className="size-4" />
                  Validate and register
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="view-dashboard h-full overflow-hidden">
      <div className="analysis-bento h-full">
        <section className="analysis-tile col-span-12 flex flex-col p-6 lg:col-span-4">
          <p className="text-xs font-medium text-[#176f6b]">Dataset registry</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#09265b]">
            Any analytical table.
          </h2>
          <p className="mt-4 text-sm leading-6 text-[#66758e]">
            Lens identifies time, measures, and dimensions, then proves which analyses the source can support.
          </p>
          <div className="mt-6 grid gap-3">
            {[
              [Database, "Inspect", "Read schema metadata"],
              [Waypoints, "Map", "Assign analytical roles"],
              [ShieldCheck, "Prove", "Profile and verify Arrow"],
            ].map(([Icon, label, detail]) => {
              const StepIcon = Icon as typeof Database;
              return (
                <div className="flex items-center gap-3 rounded-2xl bg-[#f4f7fb] p-3" key={label as string}>
                  <span className="grid size-9 place-items-center rounded-xl bg-white text-[#1769df]">
                    <StepIcon className="size-4" />
                  </span>
                  <span>
                    <span className="block text-xs font-semibold text-[#09265b]">{label as string}</span>
                    <span className="mt-0.5 block text-[11px] text-[#66758e]">{detail as string}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <button
            className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-[#09265b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            disabled={registry?.registryConnected !== true}
            onClick={() => setAdding(true)}
            type="button"
          >
            <Plus className="size-4" />
            Add data source
          </button>
          <input
            aria-label="Data source admin token"
            autoComplete="off"
            className="mt-3 rounded-xl border border-[#09265b]/10 bg-white/65 px-3 py-2 text-xs text-[#09265b] outline-none"
            onChange={(event) => setAdminToken(event.target.value)}
            placeholder="Admin token · production only"
            type="password"
            value={adminToken}
          />
          <button
            className="mt-2 rounded-xl border border-[#09265b]/10 bg-white/70 px-3 py-2 text-xs font-semibold text-[#09265b] disabled:opacity-40"
            disabled={adminToken.length === 0 || unlockMutation.isPending}
            onClick={() => unlockMutation.mutate()}
            type="button"
          >
            Unlock registered sources
          </button>
          {registry?.registryConnected === false && (
            <p className="mt-2 text-center text-[11px] text-[#9f3948]">
              Connect PostgreSQL and apply migration 0002 first.
            </p>
          )}
        </section>

        <section className="analysis-tile col-span-12 min-h-0 overflow-hidden p-6 lg:col-span-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs text-[#66758e]">Available sources</p>
              <h3 className="mt-2 text-xl font-semibold text-[#09265b]">
                Ready to analyse
              </h3>
            </div>
            <span className="rounded-xl bg-[#f5c400]/12 px-3 py-2 text-xs font-medium text-[#8b7100]">
              analytical_table/v1
            </span>
          </div>

          <div className="soft-scrollbar mt-5 grid max-h-[calc(100%-4rem)] gap-3 overflow-y-auto">
            {registry?.sources.map((source) => (
              <article
                className={`rounded-2xl border p-4 ${
                  source.selected
                    ? "border-[#21c5be]/45 bg-[#21c5be]/6"
                    : "border-[#09265b]/8 bg-white/55"
                }`}
                key={`${source.slug}:${source.version}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate text-sm font-semibold text-[#09265b]">
                        {source.displayName}
                      </h4>
                      {source.selected && (
                        <span className="rounded-full bg-[#21c5be]/15 px-2 py-0.5 text-[10px] font-semibold text-[#176f6b]">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-[#66758e]">
                      {source.database}.{source.table} · v{source.version}
                    </p>
                  </div>
                  {!source.selected && (
                    <button
                      className="shrink-0 rounded-xl border border-[#09265b]/10 bg-white px-3 py-2 text-xs font-semibold text-[#09265b]"
                      onClick={() => selectMutation.mutate(source.slug)}
                      type="button"
                    >
                      Use source
                    </button>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[#8591a5]">Rows</p>
                    <p className="mt-1 font-semibold tabular-nums text-[#09265b]">{formatRows(source.rowCount)}</p>
                  </div>
                  <div>
                    <p className="text-[#8591a5]">Coverage</p>
                    <p className="mt-1 font-semibold text-[#09265b]">
                      {source.dateFrom === null || source.dateTo === null
                        ? "No time field"
                        : `${source.dateFrom.slice(0, 4)}–${source.dateTo.slice(0, 4)}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#8591a5]">Arena</p>
                    <p className="mt-1 font-semibold text-[#09265b]">{source.queryArenaEligible ? "Enabled" : "Baseline"}</p>
                  </div>
                </div>
              </article>
            ))}
            {(registryError ?? clientError) !== null && (
              <p className="rounded-2xl bg-[#ff6372]/8 p-4 text-xs text-[#9f3948]">
                {(registryError ?? clientError)?.message}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
