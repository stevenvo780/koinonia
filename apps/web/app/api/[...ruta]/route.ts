/**
 * Proxy hacia el servicio de gobernanza.
 *
 * Existe para que la cookie de sesión sea de **primera parte**. La alternativa —que el navegador
 * hable directamente con la API en otro puerto— obliga a CORS con credenciales y a `SameSite=None`,
 * que es exactamente la configuración que abre la puerta a que un sitio cualquiera use la sesión de
 * alguien. Un proxy de treinta líneas cuesta menos que esa decisión.
 *
 * No transforma nada: reenvía el cuerpo tal cual y devuelve la respuesta tal cual, incluida la
 * cabecera `set-cookie`. Cualquier traducción aquí sería una segunda fuente de verdad.
 *
 * **No reenvía ninguna cabecera de dirección** (`x-forwarded-for`, `x-real-ip`): la API no las
 * quiere y este proxy no se las va a inventar.
 */

import { type NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function base(): string {
  return process.env['KOINONIA_API_URL'] ?? 'http://127.0.0.1:3001';
}

async function reenviar(request: NextRequest, ruta: string[]): Promise<NextResponse> {
  const destino = new URL(`${base()}/${ruta.join('/')}`);
  destino.search = request.nextUrl.search;

  const cabeceras = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie !== null) cabeceras.set('cookie', cookie);
  const auth = request.headers.get('authorization');
  if (auth !== null) cabeceras.set('authorization', auth);
  const tipo = request.headers.get('content-type');
  if (tipo !== null) cabeceras.set('content-type', tipo);
  cabeceras.set('accept', 'application/json');

  let cuerpo: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    cuerpo = await request.text();
  }

  try {
    const respuesta = await fetch(destino, {
      method: request.method,
      headers: cabeceras,
      ...(cuerpo === undefined ? {} : { body: cuerpo }),
      redirect: 'manual',
      cache: 'no-store',
    });

    const salida = new NextResponse(await respuesta.text(), {
      status: respuesta.status,
      headers: {
        'content-type': respuesta.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
    // `set-cookie` puede venir repetida; `getSetCookie` conserva todas.
    for (const galleta of respuesta.headers.getSetCookie()) {
      salida.headers.append('set-cookie', galleta);
    }
    const descarga = respuesta.headers.get('content-disposition');
    if (descarga !== null) salida.headers.set('content-disposition', descarga);
    return salida;
  } catch {
    // Sin conexión con el servicio. Se dice en palabras, no con un código.
    return NextResponse.json(
      {
        codigo: 'SIN_CONEXION',
        mensaje:
          'No pudimos hablar con el servidor. Si estás sin conexión, lo que ves es lo último que ' +
          'se descargó y abajo dice de cuándo es.',
        queHacer: 'Volvé a intentarlo cuando tengas señal. No se pierde lo que ya estaba escrito.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}

interface Contexto {
  readonly params: Promise<{ readonly ruta: string[] }>;
}

export async function GET(request: NextRequest, contexto: Contexto): Promise<NextResponse> {
  return reenviar(request, (await contexto.params).ruta);
}

export async function POST(request: NextRequest, contexto: Contexto): Promise<NextResponse> {
  return reenviar(request, (await contexto.params).ruta);
}
