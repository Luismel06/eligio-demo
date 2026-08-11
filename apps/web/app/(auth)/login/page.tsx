'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, LockKeyhole, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login } from '@/lib/api';
import { getSession, saveSession } from '@/lib/auth-session';
import { canAccessPath, getDefaultPathForSession } from '@/lib/authorization';

const loginSchema = z.object({
  email: z.string().email('Ingresa un correo valido.'),
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres.'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState('/dashboard');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const safeNextPath = getSafeNextPath(params.get('next'));
    setNextPath(safeNextPath);

    const currentSession = getSession();
    if (currentSession) {
      router.replace(
        canAccessPath(currentSession, safeNextPath)
          ? safeNextPath
          : getDefaultPathForSession(currentSession),
      );
    }
  }, [router]);

  async function onSubmit(values: LoginFormValues) {
    setLoginError(null);

    try {
      const response = await login(values.email, values.password);
      const session = saveSession(response);
      router.push(canAccessPath(session, nextPath) ? nextPath : getDefaultPathForSession(session));
    } catch {
      setLoginError('No pudimos iniciar sesion con esas credenciales.');
    }
  }

  return (
    <main className="grid min-h-screen bg-zinc-950 lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative flex min-h-[32rem] overflow-hidden bg-black px-5 py-6 text-white sm:px-10 lg:min-h-screen">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-10 top-8 text-[5rem] font-semibold leading-none text-white/[0.035] sm:text-[10rem] lg:-right-16 lg:top-12 lg:text-[15rem]">
            CoreStack
          </div>
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-zinc-950 to-transparent lg:h-40" />
        </div>

        <div className="relative z-10 flex w-full flex-col justify-between">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-[#f36c10]" />
            Portal operativo
          </div>

          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center py-8 text-center lg:py-12">
            <div className="flex aspect-square w-full max-w-[16rem] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black p-4 shadow-2xl shadow-black/50 sm:max-w-[20rem] sm:p-6 lg:max-w-[24rem]">
              <img
                src="/tenants/RIVNU.jpeg"
                alt="Logo Ferreteria RIVNU"
                className="max-h-full max-w-full object-contain"
                width={384}
                height={384}
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </div>
            <p className="mt-6 text-xs font-medium uppercase tracking-[0.18em] text-[#f36c10] sm:text-sm lg:mt-8">
              Ferreteria RIVNU
            </p>
            <h1 className="mt-3 max-w-xl text-2xl font-semibold leading-tight sm:text-4xl">
              Acceso privado para POS, facturacion e inventario.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-300">
              Plataforma CoreStack configurada exclusivamente para la operacion diaria de RIVNU.
            </p>
          </div>

          <p className="text-center text-xs text-zinc-500 sm:text-left">Powered by CoreStack</p>
        </div>
      </section>

      <section className="flex items-center justify-center bg-zinc-100 px-4 py-8 sm:px-6 lg:py-10">
        <Card className="w-full max-w-md border-zinc-200 bg-white shadow-xl shadow-zinc-950/5">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-md bg-zinc-950 text-sm font-bold text-white">
              R
            </div>
            <CardTitle>Ferreteria RIVNU</CardTitle>
            <CardDescription>Acceso de personal autorizado</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" autoComplete="off" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    className="pl-9"
                    autoComplete="off"
                    placeholder="usuario@rivnu.local"
                    {...register('email')}
                  />
                </div>
                {errors.email ? (
                  <p className="text-sm text-danger">{errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contrasena</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    className="pl-9"
                    autoComplete="off"
                    placeholder="Tu contrasena"
                    {...register('password')}
                  />
                </div>
                {errors.password ? (
                  <p className="text-sm text-danger">{errors.password.message}</p>
                ) : null}
              </div>

              {loginError ? <p className="text-sm text-danger">{loginError}</p> : null}

              <Button
                className="w-full bg-[#f36c10] text-white shadow-sm hover:bg-[#d85f0e]"
                type="submit"
                disabled={isSubmitting}
              >
                Iniciar sesion
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>Powered by</span>
              <span className="font-semibold text-zinc-700">CoreStack</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function getSafeNextPath(next: string | null) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) {
    return '/dashboard';
  }

  return next;
}
