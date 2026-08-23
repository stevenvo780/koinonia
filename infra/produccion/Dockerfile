# Imagen de la API de Koinonía.
#
# Base fijada a `node:22.17.0-alpine3.22` porque es la que YA está en la caché de esta máquina: no
# se descarga nada nuevo y no se instala Node en el host.
#
# El contexto de build es /opt/koinonia/repo, que llega por rsync sin node_modules, sin dist y sin
# *.tsbuildinfo. Lo último importa: un tsbuildinfo viejo sin su dist haría que `tsc --build` se
# creyera al día y no emitiera nada.

FROM node:22.17.0-alpine3.22

ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
RUN corepack enable

WORKDIR /app
COPY . /app

# Se instalan también las dependencias de desarrollo: hacen falta para compilar (typescript).
# pnpm 10+ no ejecuta scripts de build de dependencias salvo lista blanca, y pnpm-workspace.yaml
# deniega explícitamente los cuatro que hay (cpu-features, protobufjs, ssh2, sharp).
RUN pnpm install --frozen-lockfile && pnpm run build

# El árbol llega con los modos del origen (rsync -a los conserva) y en el repositorio son 750. El
# proceso corre como `node`, no como root, así que sin esto no puede ni atravesar /app.
# Se abre en LECTURA, no en escritura, y los ficheros siguen siendo de root: el servicio puede leer
# su propio código y no puede modificarlo. No hay secretos en el árbol; los secretos van en el
# env_file, que vive fuera de la imagen.
RUN chmod -R a+rX /app

# NODE_ENV se pone DESPUÉS del install a propósito: antes habría saltado las devDependencies y no
# habría con qué compilar. En ejecución lo vuelve a fijar el env_file.
ENV NODE_ENV=production
USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -q -O- http://127.0.0.1:3001/salud || exit 1

CMD ["node", "services/api/dist/bin.js"]
