import { ChatSessionClient } from "./ChatSessionClient";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <ChatSessionClient sessionId={id} />;
}
