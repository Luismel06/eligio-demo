'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, LoaderCircle, LockKeyhole, Mail } from 'lucide-react';
import Image from 'next/image';
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
import styles from './login.module.css';

const loginSchema = z.object({
  email: z.string().email('Ingresa un correo válido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
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
      setLoginError('No pudimos iniciar sesión con esas credenciales.');
    }
  }

  return (
    <main className="grid min-h-screen bg-zinc-950 lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative flex min-h-[32rem] overflow-hidden bg-black px-5 py-6 text-white sm:px-10 lg:min-h-screen">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-10 top-8 text-[5rem] font-semibold leading-none text-white/[0.035] sm:text-[10rem] lg:-right-16 lg:top-12 lg:text-[15rem]">
            EligioValdez
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
                src="/logo.png"
                alt="Logo EligioValdez Comercial"
                className="max-h-full max-w-full object-contain"
                width={384}
                height={384}
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </div>
            <p className="mt-6 text-xs font-medium uppercase tracking-[0.18em] text-[#f36c10] sm:text-sm lg:mt-8">
              EligioValdez Comercial
            </p>
            <h1 className="mt-3 max-w-xl text-2xl font-semibold leading-tight sm:text-4xl">
              Acceso privado para POS, facturación e inventario.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-300">
              Plataforma configurada para la operación diaria de EligioValdez Comercial.
            </p>
          </div>

          <p className="text-center text-xs text-zinc-500 sm:text-left">Powered by CoreStack</p>
        </div>
      </section>

      <section className="relative flex min-h-[42rem] items-center justify-center overflow-hidden bg-white px-4 py-8 sm:px-6 lg:min-h-screen lg:py-10">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(59,130,246,0.13),transparent_48%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-white via-blue-50/45 to-slate-100/80" />
          <div className={`${styles.gridPattern} absolute inset-0 opacity-[0.32]`} />
          <div
            className={`${styles.ambientOne} absolute -left-28 top-[8%] h-64 w-64 rounded-full bg-sky-300/25 blur-3xl`}
          />
          <div
            className={`${styles.ambientTwo} absolute -right-32 bottom-[8%] h-80 w-80 rounded-full bg-blue-200/35 blur-3xl`}
          />
          <div
            className={`${styles.coreStackWordmark} absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center px-4`}
          >
            <span className="select-none text-center text-[clamp(2.25rem,8vw,5.5rem)] font-black leading-none tracking-[-0.055em] text-[#0b4cae]/[0.12]">
              CoreStack
            </span>
          </div>
        </div>

        <Card
          className={`${styles.cardEntrance} ${styles.loginCard} relative z-10 w-full max-w-md overflow-hidden border-zinc-200/90 bg-white/[0.96] shadow-[0_28px_80px_-32px_rgba(15,48,95,0.4)] backdrop-blur-xl`}
        >
          <div className="h-1 bg-gradient-to-r from-[#1d74df] via-[#f36c10] to-[#ffab4c]" />
          <CardHeader className="text-center">
            <div className="relative mx-auto mb-4 h-20 w-20 overflow-hidden rounded-2xl border border-white/70 bg-blue-700 shadow-[0_14px_32px_-14px_rgba(0,37,120,0.85)] ring-1 ring-blue-200/50">
              <Image
                src="/branding/corestack-login-background.png"
                alt="Logo CoreStack"
                fill
                unoptimized
                sizes="80px"
                className="object-cover object-center"
              />
            </div>
            <CardTitle>EligioValdez Comercial</CardTitle>
            <CardDescription>Acceso de personal autorizado</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} aria-busy={isSubmitting}>
              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="email"
                    type="email"
                    className="pl-9"
                    autoComplete="username"
                    placeholder="usuario@eligiovaldez.local"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? 'email-error' : undefined}
                    {...register('email')}
                  />
                </div>
                {errors.email ? (
                  <p id="email-error" className="text-sm text-danger">
                    {errors.email.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="password"
                    type="password"
                    className="pl-9"
                    autoComplete="current-password"
                    placeholder="Tu contraseña"
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    {...register('password')}
                  />
                </div>
                {errors.password ? (
                  <p id="password-error" className="text-sm text-danger">
                    {errors.password.message}
                  </p>
                ) : null}
              </div>

              {loginError ? (
                <p className="text-sm text-danger" role="alert" aria-live="polite">
                  {loginError}
                </p>
              ) : null}

              <Button
                className="group w-full bg-[#f36c10] text-white shadow-sm hover:bg-[#d85f0e]"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Iniciando sesión…
                  </>
                ) : (
                  <>
                    Iniciar sesión
                    <ArrowRight
                      className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </>
                )}
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
