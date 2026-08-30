# Ser testigo de Koinonía

Esto es para vos si alguien te pidió ser testigo, o si leíste en
[la página de arquitectura](https://koinonia-udea.stevenvallejo.com/arquitectura) que hace falta y
querés saber qué implica antes de decir que sí.

No hace falta que confíes en nadie para leer esto, ni que entiendas cómo está hecho el sistema.

---

## Qué es, en una frase

Cada tanto, Koinonía publica un resumen de todo lo que pasó en la plataforma. Vos recibís ese
resumen por correo y respondés firmándolo con tu propia llave. Desde ese momento, **tu firma es una
de las que hacen falta para que una constancia sea firme** — y quien administra el servidor no puede
producirla por vos.

Ése es el punto entero: una firma hecha con una llave que viva en el servidor no cuenta. Está en el
código, no es una promesa.

## Qué te va a costar de verdad

- **Una vez, para empezar:** unos diez minutos. Crear una llave si no tenés, y mandar dos datos.
- **Después:** **un correo al día**, no más. Responderlo son dos órdenes copiadas y pegadas, más
  responder el correo. Un par de minutos.

Ese «un correo al día» es un número del sistema, no una estimación optimista: está en
`KOINONIA_ANCLAJE_CORREO_CADA_HORAS`, y por defecto vale 24. Antes el sistema escribía en cada corte
de registro —una vez por hora— y eso era sencillamente inaceptable pedírselo a nadie; se cambió por
eso.

**Si un día no respondés, no pasa nada malo.** No se rompe nada ni se pierde nada: simplemente esa
constancia se queda sin tu firma y espera. No hay guardia ni turnos.

## Qué NO te va a costar

- **No instalás nada nuestro.** Ni un programa, ni una cuenta, ni una aplicación.
- **No hace falta tener un servidor** ni saber administrar sistemas.
- **No te hacemos responsable de nada.** No estás certificando que las decisiones sean buenas ni que
  el contenido sea correcto: sólo que el resumen que te llegó el martes es el que te llegó el
  martes.
- **Tu llave no sale de tu computador.** Nunca nos la mandás. Nos mandás la parte pública, que es
  para eso.

## Lo único que hace falta que tengas

Una llave SSH. Es la misma clase de llave que usa cualquiera que suba código a GitHub o similares,
así que puede que ya tengas una. Para saberlo:

```bash
ls ~/.ssh/id_ed25519.pub
```

Si ese fichero existe, ya está. Si no:

```bash
ssh-keygen -t ed25519 -C "tu-nombre-para-koinonia"
```

Aceptá el sitio que propone y poné una contraseña si querés (te la va a pedir al firmar). Eso crea
dos ficheros: `id_ed25519` —**esto se queda con vos, no se manda a nadie, nunca**— y
`id_ed25519.pub`, que es el que sí se comparte.

## Cómo te das de alta

Mandale a quien te invitó estas dos cosas:

1. **Un correo** al que quieras recibir los resúmenes. Conviene que sea uno que mires.
2. **El contenido de tu llave pública**, o sea la salida de:

   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```

   Es una línea que empieza por `ssh-ed25519`. Se puede pegar en un chat sin problema: es pública.

Conviene que los testigos sean de **dominios de correo distintos** y, si se puede, que al menos uno
sea de fuera del Instituto. No es burocracia: si todos dependen del mismo sitio, no son varios
testigos, son uno con varios nombres.

## Qué vas a recibir, y qué respondés

Un correo con el resumen, y dentro las instrucciones exactas para tu caso. Se parecen a esto:

```
  printf '\020%s' '{...}' > acuse.json
  ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n koinonia-anclaje acuse.json
```

Y después respondés el correo pegando el contenido de `acuse.json.sig` y una línea
`koinonia-visto: <fecha>` que también viene en el correo.

Dos cosas que conviene saber antes de que te pasen:

- **El `printf` no es un capricho.** El fichero tiene que empezar por un byte de control que un
  copiar-y-pegar destruiría, y una firma sobre el fichero equivocado no vale para nada. Por eso el
  correo te da la orden entera hecha.
- **Si no querés firmar, respondé igual.** Tu acuse queda registrado como informativo: no cuenta
  para el umbral, pero sirve si algún día tenés que exhibir tu propia copia de ese correo.

## Qué podés hacer con esto que nadie más puede

Guardá los correos. Son tuyos y no dependen del servidor.

Si algún día el historial que publica Koinonía no cuadrara con los resúmenes que vos firmaste, tenés
la prueba en tu buzón, firmada por vos, con fecha. Nadie puede quitártela ni reescribirla — y ésa es
exactamente la razón por la que el sistema pide testigos que no sean el servidor.

Podés además comprobarlo por tu cuenta cuando quieras, sin pedirle permiso a nadie:

```bash
curl -O -J https://koinonia-udea.stevenvallejo.com/api/integridad/paquete.tar.gz
tar -xzf historial-koinonia.tar.gz -C historial
```

Dentro del paquete va `README-VERIFICACION.txt`, con el procedimiento completo escrito para que
alguien con un lenguaje de programación corriente y una tarde pueda rehacer la comprobación entera
—aunque no exista ni el programa que la hace, ni la plataforma, ni las personas que la escribieron.

## Cómo te das de baja

Decilo y ya. Se te quita del padrón y dejás de recibir correos. Los que ya firmaste siguen siendo
válidos: son hechos con fecha, no un compromiso que se pueda retirar hacia atrás.

---

## Para quien administra: cómo se añade un testigo

Los datos que te dio la persona van a `KOINONIA_ANCLAJE_TESTIGOS` en `/opt/koinonia/.env`, con el
formato `id|correo|clave-pública`, separando testigos con `;`:

```
KOINONIA_ANCLAJE_TESTIGOS='ana|ana@ejemplo.edu.co|ssh-ed25519 AAAA...;beto|beto@otro.org|ssh-ed25519 AAAA...'
```

Hacen falta además `KOINONIA_ANCLAJE_SMTP_*` (para que salga el correo) y `KOINONIA_ANCLAJE_IMAP_*`
(para recoger los acuses). **Sin IMAP el correo sale pero nadie recoge las respuestas y el anclaje
nunca pasa de «pendiente»**; el arranque lo avisa con esas palabras. Y conviene DKIM
(`KOINONIA_ANCLAJE_DKIM_*`, la clave en un fichero y nunca en una variable de entorno): sin firmar,
una parte previsible del correo acaba en spam, que se parece mucho a un testigo que calla.

Después, `cd /opt/koinonia && docker compose up -d` — hace falta `up -d` y no `restart`, porque el
contenedor lee el `.env` al crearse. Los detalles completos, y qué mirar en el arranque, están en
`infra/produccion/ANCLAJE.md` §7.2 y §7.4.

El umbral por defecto es de **tres dominios distintos** para que la clase cuente, y el quórum general
son **dos clases de testigo distintas**. Hoy sólo funciona `blockchain`, así que hasta que esta clase
esté en pie ninguna constancia está firme — y el verificador lo dice en ámbar, que es la verdad.
