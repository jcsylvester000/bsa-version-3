import { LoginForm } from '@/components/LoginForm';
import { isMockAuth } from '@/lib/auth/mockUsers';

export const dynamic = 'force-dynamic';

/** Server wrapper: decides on the server whether demo logins exist, so the client form never
 *  shows (or prefills) demo credentials on a deployment where they would not work (F-27). */
export default function LoginPage() {
  return <LoginForm demo={isMockAuth()} />;
}
