import { Database, FileDigit } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleHeader } from '@/components/operations/module-header';

const settings = [
  {
    title: 'Importaciones',
    description: 'Base para cargar productos, clientes, inventario inicial e historicos.',
    href: '/settings/imports',
    icon: Database,
  },
  {
    title: 'Secuencias fiscales',
    description: 'Preparacion para e-CF/DGII y reserva de numeraciones por tipo.',
    href: '/settings/fiscal-sequences',
    icon: FileDigit,
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Configuracion"
        description="Ajustes operativos de EligioValdez Comercial sobre la plataforma CoreStack."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {settings.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:bg-muted">
              <CardHeader>
                <item.icon className="h-5 w-5 text-accent" />
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm font-medium">Abrir modulo</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
