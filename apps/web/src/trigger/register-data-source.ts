import { logger, metadata, schemaTask } from "@trigger.dev/sdk";

import {
  compatibilityCheckSchema,
  registerDataSourceSchema,
  registrationResultSchema,
} from "@/lib/data-sources/contracts";
import { validateAnalyticalCompatibility } from "@/lib/data-sources/compatibility";
import { generateAnalyticalManifest } from "@/lib/data-sources/manifest-agent";
import { registerCompatibleDataSource } from "@/lib/data-sources/registry";
import { inspectClickHouseRelation } from "@/lib/clickhouse/schema-inspection";

export const registerDataSourceTask = schemaTask({
  id: "register-data-source",
  schema: registerDataSourceSchema,
  maxDuration: 120,
  queue: {
    name: "data-source-validation-v2",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 5_000,
    factor: 2,
  },

  run: async (input) => {
    await metadata.set("phase", "inspecting").set("progress", 0.1).flush();
    const inspection = await inspectClickHouseRelation(
      input.database,
      input.table,
    );

    if (inspection.isErr()) {
      throw new Error(inspection.error.message, {
        cause: inspection.error.cause,
      });
    }

    let manifest = input.manifest;

    if (manifest === undefined) {
      await metadata
        .set("phase", "generating_manifest")
        .set("progress", 0.22)
        .flush();
      const generated = await generateAnalyticalManifest(
        inspection.value,
        input.mappingSql,
      );

      if (generated.isErr()) {
        throw new Error(generated.error.message, {
          cause: generated.error.cause,
        });
      }

      manifest = generated.value;
    }

    await metadata
      .set("phase", "validating_mapping")
      .set("progress", 0.3)
      .flush();
    const validation = await validateAnalyticalCompatibility(
      input.mappingSql,
      inspection.value,
      manifest,
      {
        onMappingValidated: async () => {
          await metadata
            .set("phase", "profiling")
            .set("progress", 0.45)
            .flush();
        },
        onProfiled: async () => {
          await metadata
            .set("phase", "verifying_arrow")
            .set("progress", 0.72)
            .flush();
        },
      },
    );

    if (validation.isErr()) {
      logger.warn("Dataset mapping is not analytically compatible", {
        slug: input.slug,
        message: validation.error.message,
      });

      await metadata.set("phase", "completed").set("progress", 1).flush();

      return registrationResultSchema.parse({
        status: "incompatible",
        compatibility: compatibilityCheckSchema.parse({
          compatible: false,
          checks: [
            {
              key: "mapping",
              label: "Analytical table contract",
              passed: false,
              detail: validation.error.message,
            },
          ],
        }),
        message: validation.error.message,
      });
    }

    await metadata.set("phase", "registering").set("progress", 0.86).flush();
    const registered = await registerCompatibleDataSource(
      input,
      inspection.value,
      validation.value,
    );

    if (registered.isErr()) {
      throw new Error(registered.error.message, {
        cause: registered.error.cause,
      });
    }

    await metadata.set("phase", "completed").set("progress", 1).flush();

    return registrationResultSchema.parse({
      status: "compatible",
      source: registered.value,
      compatibility: validation.value.compatibility,
      validationMs: validation.value.validationMs,
      rustVerified: validation.value.rustVerified,
    });
  },
});
