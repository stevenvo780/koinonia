/**
 * Qué adaptador de correo elige el arranque, y **que lo diga**.
 *
 * Sin correo nadie entra. Los dos modos de fallo que estas pruebas existen para impedir son
 * simétricos y los dos son silenciosos:
 *
 *  · Creer que se están mandando correos cuando no. El despliegue responde `202` a cada solicitud de
 *    enlace, nadie recibe nada, y el enlace se queda impreso en un registro que la persona no lee.
 *  · Creer que no se están mandando cuando sí, y dejar el `consoleMailer` en producción «hasta que
 *    configuremos el SMTP», que es como los enlaces de entrada acaban en el agregador de trazas.
 *
 * Por eso `mailerDeEntorno` devuelve el anuncio junto con el adaptador: la línea que se escribe al
 * arrancar no es decoración, es la única forma de saber en qué modo está la máquina sin leer código.
 */

import { describe, expect, it } from 'vitest';

import { consoleMailer } from '../src/http/adapters.js';
import { mailerDeEntorno, modoTlsDeEntorno } from '../src/server.js';

const MINIMO = {
  KOINONIA_SMTP_HOST: 'smtp.udea.edu.co',
  KOINONIA_SMTP_FROM: 'Koinonía <koinonia@udea.edu.co>',
} as const;

describe('sin KOINONIA_SMTP_HOST', () => {
  it('en desarrollo cae al adaptador de consola y lo dice sin dramatismo', () => {
    const elegido = mailerDeEntorno({}, { modoDesarrollo: true });
    expect(elegido.mailer).toBe(consoleMailer);
    expect(elegido.grave).toBe(false);
    expect(elegido.anuncio).toContain('CONSOLA');
    expect(elegido.anuncio).toContain('no sale ningún correo');
  });

  it('en producción cae al mismo adaptador y lo dice como lo que es: una avería', () => {
    const elegido = mailerDeEntorno({}, { modoDesarrollo: false });
    expect(elegido.mailer).toBe(consoleMailer);
    // `grave` es lo que manda la línea a `stderr` en vez de a `stdout`.
    expect(elegido.grave).toBe(true);
    expect(elegido.anuncio).toContain('PRODUCCIÓN');
    expect(elegido.anuncio).toContain('NADIE puede entrar');
    expect(elegido.anuncio).toContain('IMPRESOS EN EL REGISTRO');
    expect(elegido.anuncio).toContain('KOINONIA_SMTP_HOST');
  });

  it('una variable con sólo espacios cuenta como ausente, no como un host llamado «   »', () => {
    expect(mailerDeEntorno({ KOINONIA_SMTP_HOST: '   ' }, { modoDesarrollo: true }).mailer).toBe(
      consoleMailer,
    );
  });
});

describe('con KOINONIA_SMTP_HOST', () => {
  it('elige SMTP y anuncia servidor, puerto, cifrado y remitente', () => {
    const elegido = mailerDeEntorno(MINIMO, { modoDesarrollo: false });
    expect(elegido.mailer).not.toBe(consoleMailer);
    expect(elegido.grave).toBe(false);
    expect(elegido.anuncio).toContain('SMTP contra smtp.udea.edu.co');
    expect(elegido.anuncio).toContain('puerto 587');
    expect(elegido.anuncio).toContain('STARTTLS');
    expect(elegido.anuncio).toContain('sin autenticar');
    expect(elegido.anuncio).toContain('Koinonía <koinonia@udea.edu.co>');
    expect(elegido.anuncio).toContain('NO se imprimen');
  });

  it('con credenciales lo dice, y dice el usuario, que es lo que hay que cotejar con el servidor', () => {
    const elegido = mailerDeEntorno(
      { ...MINIMO, KOINONIA_SMTP_USER: 'koinonia', KOINONIA_SMTP_PASS: 'x' },
      { modoDesarrollo: false },
    );
    expect(elegido.anuncio).toContain('autenticado como koinonia');
    // La contraseña no entra en el anuncio: la primera línea del registro se copia y se pega.
    expect(elegido.anuncio).not.toContain('x,');
  });

  it('sin remitente NO arranca: un `From` inventado por el programa lo tumba el SPF del receptor', () => {
    expect(() =>
      mailerDeEntorno({ KOINONIA_SMTP_HOST: 'smtp.udea.edu.co' }, { modoDesarrollo: false }),
    ).toThrow(/falta KOINONIA_SMTP_FROM/u);
  });

  it('usuario sin contraseña —o al revés— es un error de configuración, no medio inicio de sesión', () => {
    expect(() =>
      mailerDeEntorno({ ...MINIMO, KOINONIA_SMTP_USER: 'koinonia' }, { modoDesarrollo: false }),
    ).toThrow(/van juntas o no van/u);
    expect(() =>
      mailerDeEntorno({ ...MINIMO, KOINONIA_SMTP_PASS: 'x' }, { modoDesarrollo: false }),
    ).toThrow(/van juntas o no van/u);
  });
});

describe('puerto por defecto según el cifrado', () => {
  it('587 con STARTTLS, 465 con TLS implícito, 25 sin cifrar', () => {
    const puertoDe = (tls: string | undefined): string =>
      mailerDeEntorno(tls === undefined ? MINIMO : { ...MINIMO, KOINONIA_SMTP_TLS: tls }, {
        modoDesarrollo: false,
      }).anuncio;

    expect(puertoDe(undefined)).toContain('puerto 587');
    expect(puertoDe('implicita')).toContain('puerto 465');
    expect(puertoDe('no')).toContain('puerto 25');
  });

  it('KOINONIA_SMTP_PORT manda sobre el defecto', () => {
    expect(
      mailerDeEntorno({ ...MINIMO, KOINONIA_SMTP_PORT: '2525' }, { modoDesarrollo: false }).anuncio,
    ).toContain('puerto 2525');
  });

  it('un puerto que no es un puerto se rechaza al arrancar, no al primer correo', () => {
    for (const malo of ['no-es-un-puerto', '0', '70000', '58.7']) {
      expect(() =>
        mailerDeEntorno({ ...MINIMO, KOINONIA_SMTP_PORT: malo }, { modoDesarrollo: false }),
      ).toThrow(/KOINONIA_SMTP_PORT debe ser un puerto TCP/u);
    }
  });
});

describe('KOINONIA_SMTP_TLS', () => {
  it('el defecto es STARTTLS: el seguro, no el cómodo', () => {
    expect(modoTlsDeEntorno(undefined)).toBe('starttls');
  });

  it('entiende el «sí» como lo escribe la gente', () => {
    for (const si of ['si', 'sí', '1', 'true', 'yes', 'on', 'STARTTLS']) {
      expect(modoTlsDeEntorno(si)).toBe('starttls');
    }
  });

  it('entiende el «no», y entonces el anuncio avisa de que va sin cifrar', () => {
    for (const no of ['no', '0', 'false', 'off', 'ninguna']) {
      expect(modoTlsDeEntorno(no)).toBe('ninguna');
    }
    const elegido = mailerDeEntorno(
      { ...MINIMO, KOINONIA_SMTP_TLS: 'no' },
      { modoDesarrollo: false },
    );
    expect(elegido.anuncio).toContain('SIN CIFRAR');
    // Sin cifrar el enlace de entrada viaja legible por la red: la línea va a `stderr`.
    expect(elegido.grave).toBe(true);
  });

  it('admite `implicita` para los servidores que sólo escuchan en 465', () => {
    expect(modoTlsDeEntorno('implicita')).toBe('implicita');
    expect(modoTlsDeEntorno('implícita')).toBe('implicita');
  });

  it('un valor que no entiende NO se interpreta como «no»: se para y lo explica', () => {
    // Lo contrario sería que una errata —`KOINONIA_SMTP_TLS=ture`— apagara el cifrado en silencio.
    expect(() => modoTlsDeEntorno('ture')).toThrow(/no entiende «ture»/u);
    expect(() => modoTlsDeEntorno('quizás')).toThrow(/STARTTLS/u);
  });
});
