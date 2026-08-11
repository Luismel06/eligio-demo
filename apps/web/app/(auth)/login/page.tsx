'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
    <main
      className={`${styles.scene} relative min-h-[100svh] overflow-x-hidden bg-[#06153f] text-zinc-950`}
    >
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <Image
          src="/branding/corestack-login-background.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className={`${styles.backgroundImage} object-cover object-center`}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(16,96,220,0.08),rgba(1,9,32,0.5)_74%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0b72df]/5 via-[#061b4b]/20 to-[#01071a]/75" />
        <div className={`${styles.gridPattern} absolute inset-0 opacity-[0.12]`} />
        <div
          className={`${styles.ambientOne} absolute -left-24 top-[12%] h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl`}
        />
        <div
          className={`${styles.ambientTwo} absolute -right-32 bottom-[4%] h-96 w-96 rounded-full bg-blue-950/60 blur-3xl`}
        />
        <div
          className={`${styles.coreStackWordmark} absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center px-4`}
        >
          <span className="select-none text-center text-[clamp(2.25rem,10vw,7rem)] font-black leading-none tracking-[-0.055em] text-white/[0.2] drop-shadow-[0_8px_28px_rgba(0,24,85,0.5)]">
            CoreStack
          </span>
        </div>
      </div>

      <section className="relative z-10 flex min-h-[100svh] items-center justify-center overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:px-6">
        <div className={`${styles.cardEntrance} w-full max-w-[29rem]`}>
          <Card
            className={`${styles.loginCard} relative overflow-hidden rounded-[1.75rem] border border-white/55 bg-white/[0.94] shadow-[0_30px_90px_-28px_rgba(1,8,30,0.85)] backdrop-blur-xl`}
          >
            <div className="h-1.5 bg-gradient-to-r from-[#1d74df] via-[#f36c10] to-[#ffab4c]" />

            <CardHeader className="px-6 pb-4 pt-7 sm:px-8 sm:pt-8">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-center sm:text-left">
                <div
                  className={`${styles.logoEntrance} relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white bg-black shadow-[0_16px_34px_-16px_rgba(0,0,0,0.75)]`}
                >
                  <Image
                    src="/tenants/RIVNU.jpeg"
                    alt="Logo de Ferretería RIVNU"
                    width={112}
                    height={112}
                    priority
                    className="h-full w-full object-contain"
                  />
                </div>

                <div className={`${styles.headingEntrance} text-center sm:text-left`}>
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-blue-800">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Portal operativo
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-[1.7rem]">
                    Ferretería RIVNU
                  </h1>
                  <p className="mt-1.5 text-sm leading-5 text-slate-600">
                    Acceso de personal autorizado
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="px-6 pb-7 pt-2 sm:px-8 sm:pb-8">
              <form
                className="space-y-5"
                onSubmit={handleSubmit(onSubmit)}
                aria-busy={isSubmitting}
              >
                <div className={`${styles.fieldOne} space-y-2`}>
                  <Label className="text-sm font-semibold text-slate-700" htmlFor="email">
                    Correo
                  </Label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-3.5 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      id="email"
                      type="email"
                      className="h-12 rounded-xl border-slate-200 bg-white/85 pl-11 pr-4 shadow-inner shadow-slate-950/[0.025] transition-all placeholder:text-slate-400 hover:border-slate-300 focus-visible:border-blue-400 focus-visible:ring-blue-400/25"
                      autoComplete="username"
                      placeholder="usuario@rivnu.local"
                      aria-invalid={Boolean(errors.email)}
                      aria-describedby={errors.email ? 'email-error' : undefined}
                      {...register('email')}
                    />
                  </div>
                  {errors.email ? (
                    <p id="email-error" className="text-sm font-medium text-danger">
                      {errors.email.message}
                    </p>
                  ) : null}
                </div>

                <div className={`${styles.fieldTwo} space-y-2`}>
                  <Label className="text-sm font-semibold text-slate-700" htmlFor="password">
                    Contraseña
                  </Label>
                  <div className="relative">
                    <LockKeyhole
                      className="pointer-events-none absolute left-3.5 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      id="password"
                      type="password"
                      className="h-12 rounded-xl border-slate-200 bg-white/85 pl-11 pr-4 shadow-inner shadow-slate-950/[0.025] transition-all placeholder:text-slate-400 hover:border-slate-300 focus-visible:border-blue-400 focus-visible:ring-blue-400/25"
                      autoComplete="current-password"
                      placeholder="Tu contraseña"
                      aria-invalid={Boolean(errors.password)}
                      aria-describedby={errors.password ? 'password-error' : undefined}
                      {...register('password')}
                    />
                  </div>
                  {errors.password ? (
                    <p id="password-error" className="text-sm font-medium text-danger">
                      {errors.password.message}
                    </p>
                  ) : null}
                </div>

                {loginError ? (
                  <p
                    className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-medium text-red-700"
                    role="alert"
                    aria-live="polite"
                  >
                    {loginError}
                  </p>
                ) : null}

                <Button
                  className={`${styles.submitEntrance} group h-12 w-full rounded-xl bg-gradient-to-r from-[#ee6410] via-[#f4771c] to-[#ff9938] text-base font-semibold text-white shadow-[0_14px_30px_-14px_rgba(243,108,16,0.8)] transition-all duration-300 hover:-translate-y-0.5 hover:from-[#d95809] hover:via-[#eb6812] hover:to-[#f98a26] hover:shadow-[0_18px_34px_-14px_rgba(243,108,16,0.9)] focus-visible:ring-[#ffad62] disabled:translate-y-0`}
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

              <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-200/80 pt-5 text-xs text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600 shadow-[0_0_0_4px_rgba(37,99,235,0.1)]" />
                <span>Protegido por</span>
                <span className="font-semibold text-slate-800">CoreStack</span>
              </div>
            </CardContent>
          </Card>

          <p
            className={`${styles.footerEntrance} mt-5 text-center text-xs leading-5 text-blue-100/80`}
          >
            POS · Facturación · Inventario
          </p>
        </div>
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
