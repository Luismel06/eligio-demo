import { MobileOcrCapturePage } from '@/components/operations/mobile-ocr-capture-page';

type MobileOcrCaptureRouteProps = {
  params: Promise<{ sessionId: string }>;
};

/**
 * Esta ruta permanece fuera del dashboard deliberadamente: el teléfono no
 * necesita una sesión de la aplicación. El acceso se autoriza únicamente con
 * el token efímero que llega en el fragmento (#t=...) del QR.
 */
export default async function MobileOcrCaptureRoute({ params }: MobileOcrCaptureRouteProps) {
  const { sessionId } = await params;

  return <MobileOcrCapturePage sessionId={sessionId} />;
}
