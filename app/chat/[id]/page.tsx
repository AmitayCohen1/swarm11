import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import ChatAgentView from '@/components/chat/ChatAgentView';

interface ChatSessionPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChatSessionPage({ params }: ChatSessionPageProps) {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  const { id } = await params;

  return <ChatAgentView sessionId={id} />;
}
