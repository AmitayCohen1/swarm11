import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import AutonomousAgentView from '@/components/autonomous/AutonomousAgentView';

export default async function AutonomousPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  return <AutonomousAgentView />;
}
