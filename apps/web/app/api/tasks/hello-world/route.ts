import type { helloWorldTask } from "@/src/trigger/example";
import { tasks } from "@trigger.dev/sdk";

export async function POST() {
  const handle = await tasks.trigger<typeof helloWorldTask>("hello-world", {
    source: "web",
  });

  return Response.json(handle, { status: 202 });
}
