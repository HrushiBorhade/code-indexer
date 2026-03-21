import { getSession } from '@/lib/dal';
import { SignOutButton } from '@/components/sign-out-button';

export default async function DashboardPage() {
  const session = await getSession();

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">Welcome, {session.user.name}</p>
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}
