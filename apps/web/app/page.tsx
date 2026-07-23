import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DataSourceSelection } from "@/components/data-sources/data-source-selection";
import { PropertyChat } from "@/components/property-chat";
import { parsePropertyChatId } from "@/lib/chat/session";
import {
  BUILTIN_DATA_SOURCE,
  toDataSourceProfile,
  toDataSourceSummary,
} from "@/lib/data-sources/builtin";
import { authorizeDataSourceRead } from "@/lib/data-sources/access";
import { datasetSlugSchema } from "@/lib/data-sources/contracts";
import { getAnalysisDataSource } from "@/lib/data-sources/registry";

type HomeProps = {
  readonly searchParams: Promise<{
    readonly chat?: string | string[];
    readonly dataset?: string | string[];
    readonly version?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const parameters = await searchParams;
  const requestedDataset =
    typeof parameters.dataset === "string" ? parameters.dataset : null;
  const dataset = datasetSlugSchema.safeParse(requestedDataset);
  const requestedVersion =
    typeof parameters.version === "string"
      ? Number(parameters.version)
      : Number.NaN;
  const version =
    Number.isSafeInteger(requestedVersion) && requestedVersion > 0
      ? requestedVersion
      : null;

  if (!dataset.success || version === null) {
    return (
      <main className="lens-canvas h-screen overflow-hidden p-3 sm:p-5 lg:p-7">
        <div className="lens-workspace relative mx-auto h-full max-w-[1480px] overflow-hidden">
          <DataSourceSelection />
        </div>
      </main>
    );
  }

  const chatId = parsePropertyChatId(parameters.chat);

  if (chatId === null) {
    redirect(
      `/?dataset=${encodeURIComponent(dataset.data)}&version=${version}&chat=${randomUUID()}`,
    );
  }

  const cookieStore = await cookies();
  const readAccess = authorizeDataSourceRead(
    new Request("http://lens.local", {
      headers: { Cookie: cookieStore.toString() },
    }),
  );
  const requestedSource =
    dataset.data === BUILTIN_DATA_SOURCE.slug || readAccess.isOk()
      ? await getAnalysisDataSource(dataset.data, version)
      : null;
  if (requestedSource?.isOk() !== true) {
    return (
      <main className="lens-canvas h-screen overflow-hidden p-3 sm:p-5 lg:p-7">
        <div className="lens-workspace relative mx-auto h-full max-w-[1480px] overflow-hidden">
          <DataSourceSelection />
        </div>
      </main>
    );
  }

  return (
    <main className="lens-canvas h-screen overflow-hidden p-3 sm:p-5 lg:p-7">
      <div className="lens-workspace relative mx-auto h-full max-w-[1480px] overflow-hidden">
        <PropertyChat
          chatId={chatId}
          initialDataSource={toDataSourceSummary(requestedSource.value, true)}
          initialDataSourceProfile={toDataSourceProfile(requestedSource.value)}
          key={chatId}
        />
      </div>
    </main>
  );
}
