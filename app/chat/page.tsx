import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import ChatAgentView from '@/components/chat/ChatAgentView';

export default async function ChatPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  return <ChatAgentView />;
}
