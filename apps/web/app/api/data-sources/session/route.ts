import { createDataSourceSessionCookie } from "@/lib/data-sources/access";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const session = createDataSourceSessionCookie(request);

  if (session.isErr()) {
    return Response.json(session.error, { status: session.error.status });
  }

  return Response.json(
    { authenticated: true },
    {
      headers: {
        "Set-Cookie": session.value,
      },
    },
  );
}
