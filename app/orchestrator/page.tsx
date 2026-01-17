import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import OrchestratorChat from '@/components/orchestrator/OrchestratorChat';

export default async function OrchestratorPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <OrchestratorChat />
    </div>
  );
}
