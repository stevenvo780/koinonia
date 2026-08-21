# ADR-0029: Democracia líquida con delegación caducable, tope de concentración e índice público

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` parte C, DECISIONES C.1.a–b, C.2.a–b, C.4.a–c, C.5.a–c y C.6.a; `03-deliberativa-sistemas-antipatrones.md` §5.2 y §5.7.

## Contexto

La spec 30 abre su parte C admitiendo que es «la parte más peligrosa del sistema»: **una delegación mal modelada no produce un error visible**, produce una oligarquía silenciosa. Con 300 personas y participación desigual, la delegación puede concentrar en cinco manos el peso de doscientas sin que nadie lo haya decidido.

Al mismo tiempo, prohibirla es descartar el mecanismo que permite a alguien con horario incompatible seguir teniendo voz.

## Decisión

Democracia líquida **acotada por cuatro frenos**, todos de dominio:

1. **Caducidad obligatoria.** `expiresAt` es obligatorio y acotado por `maxValidity` (un semestre). **Una sola delegación activa por `(delegante, ámbito)`**: conceder una nueva revoca la anterior. Una delegación que nadie renueva muere sola.
2. **Resolución determinista.** Especificidad primero, recencia después: delegar «filosofía política» a alguien y «todo» a otra persona resuelve por la más específica. El instante de resolución es `closedAt`, el cierre real tras prórrogas.
3. **Prevención de ciclos y tope de profundidad.** Los ciclos se **previenen al conceder**; si pese a todo se detecta uno en el escrutinio, todos sus miembros quedan en silencio. `maxDepth = 4` aristas, con **aviso obligatorio de cadena rota** a quien queda truncado.
4. **Tope de concentración.** Se calcula **sobre el censo**, no sobre el peso ejercido, y el excedente se **devuelve al delegante** (LIFO), con aplicación *ex ante*. Superar el umbral de concentración **nunca invalida** una decisión: la marca. El indicador normativo es `HHI*` (alarma en `HHI* ≥ 0.15` o `CR1 ≥ 1/20`), con Gini publicado como informativo.

Además, para lo constituyente existe `minDirectParticipation` (D.1.b): una reforma estatutaria no se aprueba con doce personas votando por doscientas ochenta.

## Alternativas consideradas

- **Sin delegación.** Excluye a quien tiene horario incompatible, que es justo la población que el proyecto quiere no perder.
- **Delegación indefinida.** La inercia acumula poder sin acto político renovado; en dos años, cinco personas tendrían el Instituto.
- **Anular la decisión al superar el tope de concentración.** Convierte el indicador en un arma: bastaría con delegar masivamente en alguien para tumbar una votación incómoda.
- **Delegación transferible o con mercado secundario.** Prohibida sin matices por ADR-0039: si el poder es transferible, es comprable.

## Consecuencias

- La delegación es un acto político **deliberado, acotado y con fecha**, no una cesión permanente.
- La concentración es **visible y pública**: el `HHI*` va en la `Proof`, no en un panel interno.
- Se cierra la vía por la que la democracia líquida degenera en oligarquía por acumulación silenciosa.

## Consecuencias negativas aceptadas

- **Fricción semestral:** hay que renovar. Se mitiga con recordatorio, pero habrá delegaciones caducadas justo antes de una votación importante.
- El truncado por `maxDepth` deja a alguien sin voz sin que haya hecho nada mal. Por eso el aviso de cadena rota es obligatorio: truncar sin avisar sería inaceptable.
- La devolución del excedente al delegante es difícil de explicar: alguien delegó y su voto acabó no ejerciéndose como esperaba.
- El tope sobre el censo puede activarse aun cuando la participación real sea baja, lo que resulta contraintuitivo.
- Sigue habiendo tensión no resuelta con `03-deliberativa-sistemas-antipatrones.md` §3.3, que quiere **debilitar** el bucle de refuerzo de los hiperactivos: la delegación lo refuerza por naturaleza. Los frenos lo acotan, no lo eliminan.
