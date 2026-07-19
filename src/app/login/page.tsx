import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/app/login/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl uppercase">Sign in</CardTitle>
          <CardDescription>
            Private league site — sign in with your Gridiron Gazette account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm callbackUrl={callbackUrl ?? "/"} />
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Don&apos;t have an account? Ask your league admin, or use one of the seeded demo
            accounts listed in the project README.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
