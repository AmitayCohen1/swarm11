import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import SessionView from '@/components/sessions/SessionView';

interface SessionPageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  const { id } = await params;

  return <SessionView sessionId={id} />;
}
