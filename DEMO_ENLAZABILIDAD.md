# Enlazabilidad de la demostración: diagnóstico y corrección

Este documento registra un defecto de privacidad encontrado en el programa de
demostración, cómo se corrigió y qué evidencia en cadena lo respalda. También deja
asentadas algunas mediciones y comportamientos del protocolo que se descubrieron en el
proceso y que conviene no volver a averiguar desde cero.

Nada de lo que sigue es un defecto del diseño del sistema de aliases: el registro de
aliases y la transferencia privada funcionaban como estaban especificados. El defecto
estaba en el programa que los ejercita.

> **Estado actual.** El registro en uso es `AliasRegistry`, desplegado en
> `0xEee312ACa2dCdCF372eDD5CE6D58419F6459bA9d`. Se desplegó de nuevo para corregir el
> orden de claves de la metadirección (ver más abajo): como los aliases son inmutables,
> arreglarlo sobre el registro anterior habría dejado entradas con dos convenciones
> distintas y sin forma de distinguirlas. El espacio de nombres vacío permitió además
> recuperar `@alice` y `@bob`.

---

## 1. El defecto

La primera ejecución de la demostración usaba **una sola billetera EVM** para las cuatro
operaciones: registrar `@alice`, registrar `@bob`, blindar los fondos y emitir la
transferencia privada.

En consecuencia, el campo `registrant` de los eventos `AliasRegistered` de ambos aliases
era la misma dirección, y esa dirección era además el `from` de la transferencia. Un
observador con acceso a un explorador de bloques podía, en dos consultas, vincular la
transferencia con los dos aliases involucrados. La propiedad que la demostración pretendía
exhibir ---que la transferencia no revela quién recibe--- quedaba anulada fuera del
protocolo, en la capa de aplicación.

| | Antes |
|---|---|
| `registrant` de `@alice` | `0xe7f9cc4f55bdabe778853882bc9c3daf2117a315` |
| `registrant` de `@bob` | `0xe7f9cc4f55bdabe778853882bc9c3daf2117a315` |
| `from` de la transferencia | `0xe7f9cc4f55bdabe778853882bc9c3daf2117a315` |

## 2. Por qué no alcanzaba con una segunda billetera EVM

La corrección evidente ---que el receptor registre su alias desde su propia dirección---
es necesaria pero **no suficiente**.

`@bob` había quedado registrado, de forma inmutable, apuntando a la dirección Railgun
derivada del mnemónico del receptor. Si el receptor reutilizaba ese mismo mnemónico bajo
un alias nuevo, el alias nuevo apuntaría a la **misma dirección `0zk`** que `@bob`, y el
vínculo se reconstruiría: un observador vería `@bob` (registrado por la billetera de la
emisora) y el alias nuevo (registrado por otra) señalando la misma dirección de recepción.

Por eso el receptor estrena **dos** identidades, no una:

- una billetera EVM nueva, desde la cual firma el registro;
- una billetera Railgun nueva, a la que el alias apunta.

El mnemónico anterior se conservó en el `.env` como `MNEMONIC_B_ANTERIOR`, únicamente para
poder reproducir el registro de `@bob`. La demostración actual no lo usa.

## 3. La corrección

En `sdk/src/examples/railgun-demo.ts`:

- Se lee `PRIVATE_KEY_B` del `.env` y se construye un segundo firmante con su propio
  `AliasRegistryClient`. El alias del receptor se registra **desde ese firmante**.
- Los aliases dejaron de estar escritos en el código: se leen de `ALIAS_A` y `ALIAS_B`,
  con `alice` y `peter` por defecto. Como los aliases son inmutables, si uno está tomado
  hay que elegir otro, y eso no debería requerir tocar el programa.
- Antes de registrar, el programa verifica que el alias no esté tomado **por otra
  billetera**: si lo está, aborta con un mensaje que indica cambiar `ALIAS_A`/`ALIAS_B` en
  lugar de continuar contra una dirección de recepción ajena.
- La emisora reutiliza su alias si ya lo registró. Que la emisora pague desde la dirección
  que registró su propio alias es el comportamiento esperado, no una fuga: quien envía
  sabe que envía, y su participación es visible de todos modos porque paga el gas.

Todas las credenciales viven en `contracts/.env`; ninguna aparece en el código ni se
imprime por consola.

## 4. Evidencia en cadena

Verificación independiente, leyendo los eventos `AliasRegistered` del contrato
`0xEee312ACa2dCdCF372eDD5CE6D58419F6459bA9d` en Polygon:

| Alias | `registrant` | Bloque | Transacción |
|---|---|---|---|
| `@alice` | `0xE7f9CC4f55bdAbe778853882bc9C3daf2117a315` | 93.699.091 | `0xf41ef261f4d5cf4bb2481f46cf723fc3a8b1199228687c607aa7a0ea1664bc8f` |
| `@bob` | `0x85b156c06204Fc214566c88A92aD479FaE163101` | 93.699.095 | `0x195170453dc72db3755e11158d1c3ecee7034b18fe8cd9efe3f45cabdee7f42c` |

- Registrantes distintos.
- Direcciones Railgun distintas.
- Ambas direcciones `0zk` miden **127 caracteres**.

Para reproducirlo: `npx ts-node src/examples/verificar-enlazabilidad.ts` desde `sdk/`.

## 5. Vínculo residual conocido

La billetera del receptor fue financiada con una transferencia proveniente de la billetera
de la emisora (`0x8b38772f3e62561232917e0753c4d146cbb9e8d83b61649c781f4e83d640ea44`,
0,3 POL). Un observador que aplique la heurística de **origen de fondos común** puede por
lo tanto conjeturar una relación entre ambas direcciones.

Es un vínculo cualitativamente más débil que el original ---ya no hay una consulta directa
que una los dos aliases--- pero existe. No depende del diseño del registro sino de cómo se
obtienen los fondos para operar: en un escenario real el receptor financiaría su billetera
por un canal independiente. Eliminarlo de la demostración requeriría fondear la segunda
billetera desde una fuente no relacionada.

## 6. El nodo de Prueba de Inocencia había desaparecido

Una nota recién blindada no es gastable hasta que el sistema de Proof of Innocence la
valida. En esta sesión nunca llegó a serlo, y la causa resultó ser mucho más interesante
que una espera.

### Síntoma

Tras blindar 0,1 USDC, el saldo *total* mostraba 0,09975 USDC y el *gastable* cero. La
transferencia fallaba con `spendable private balance too low [...] Balance: 0`. Refrescar
balances y pruebas POI, una y otra vez, no cambiaba nada.

### Diagnóstico

`getTXOsReceivedPOIStatusInfoForWallet` mostró la nota correctamente detectada (su `txid`
es el del blindaje) pero con **`poisPerList: null`**: ninguna entrada POI, ni válida, ni
bloqueada, ni pendiente. No había estado que refrescar.

Eso coincide con la lógica del motor
(`@railgun-community/engine/dist/poi/poi.js`, `getBalanceBucket`): si no hay POIs para las
listas activas y el compromiso es de blindaje, devuelve `ShieldPending`. El cliente no
distingue "todavía no validado" de "no hay con quién validar", y no emite ningún error.

### Causa

El agregador configurado, `ppoi-agg.horsewithsixlegs.xyz`, **dejó de existir**. No resuelve
en DNS, ni el subdominio ni el dominio base `horsewithsixlegs.xyz`, verificado contra los
resolutores 8.8.8.8 y 1.1.1.1. El SDK no trae ninguna lista de nodos por defecto, de modo
que no había alternativa a la cual recurrir.

Vale notar que `POI_INVESTIGATION.md` ya había atribuido un problema anterior a una URL de
nodo POI que no resolvía, y lo había resuelto apuntando justamente a este agregador. Hoy
ese reemplazo también murió. La lección no es que la URL estuviera mal escrita: es que los
fondos dependen de un servicio comunitario que puede evaporarse, y cuando lo hace, quedan
inmovilizados sin ningún error visible.

### Corrección

Se encontró un agregador operativo, `https://ppoi.fdi.network`, verificado por JSON-RPC:
`ppoi_health` devuelve `OK`, y `ppoi_node_status` informa cobertura de Polygon
sincronizada al día (índice de txid actual igual al validado) con más de 22.000 eventos de
blindaje en sus listas. Al apuntar el servicio a ese nodo, el saldo pasó a gastable de
inmediato.

La lista de nodos se lee ahora de `POI_NODE_URLS` en el `.env`, separada por comas, y
`RailgunService` aborta con un mensaje explícito si no está configurada, en lugar de
quedarse esperando en silencio. Ninguna URL quedó escrita en el código; por la misma razón
se quitaron los RPC públicos que figuraban como respaldo y `POLYGON_RPC` pasó a ser
obligatorio.

### Sobre la supuesta espera de una hora

Circula la idea de que hay un plazo fijo de una hora antes de que una nota sea gastable.
**No se pudo verificar y probablemente no existe como tal.** En el motor instalado no hay
ninguna constante semejante; la espera depende enteramente de que un agregador responda.
La cifra proviene de una nota de investigación anterior (`POI_SHIELD_PENDING_SEC = 3600`)
que no se corresponde con ninguna constante de las versiones en uso.

## 7. Mediciones de gas

> Las cifras de esta sección corresponden al **registro anterior**
> (`0x690BEA9b…`), que es donde se observó la anomalía que se analiza más abajo.
> Las mediciones vigentes, sobre el registro en uso, están en la sección 8.

Transacciones reales (Polygon, red principal):

| Operación | Gas | Precio | Costo | Bloque |
|---|---|---|---|---|
| `register @alice` (5 car.) | 236.567 | 329,7 gwei | 0,0780 POL | 86.593.146 |
| `register @peter` (5 car.) | 249.167 | 272,3 gwei | 0,0678 POL | 93.683.401 |
| blindaje de 0,1 USDC | 853.785 | 268,9 gwei | 0,2296 POL | 93.683.430 |

### Una anomalía que conviene no malinterpretar

`@alice` y `@peter` tienen **la misma longitud** (5 caracteres) y entradas
estructuralmente idénticas ---metadirección de 66 bytes con las mismas 3 palabras no
nulas, dirección de recepción de 127 caracteres, calldata de 452 bytes con idéntico
recuento de bytes cero--- sobre el mismo contrato. Aun así difieren en 12.600 unidades de
gas.

La diferencia **no proviene de las entradas**. Las dos transacciones están separadas por
siete millones de bloques (unos cinco meses), y el desplazamiento es de la red. No se pudo
identificar el cambio concreto porque el RPC disponible no sirve estado de archivo: al
pasarle un `blockTag` histórico lo ignora y ejecuta contra el estado actual, cosa que se
detectó porque la estimación devolvía `Alias: ya registrado`, algo que sólo es cierto hoy.

Consecuencia práctica: **sólo son comparables entre sí los registros contemporáneos**.
`@bob` (235.775) y `@alice` (236.567) se hicieron en la misma sesión; `@peter`, meses
después.

### Costo por carácter, medido de forma controlada

Para aislar el efecto de la longitud del alias de toda variación temporal, se estimó el
costo de registrar aliases de distintas longitudes **contra un mismo estado de la cadena**,
manteniendo constantes la metadirección y la dirección de recepción:

| Longitud | Gas |
|---:|---:|
| 3 | 251.513 |
| 5 | 252.312 |
| 8 | 253.509 |
| 12 | 255.106 |
| 16 | 256.702 |
| 24 | 259.895 |
| 32 | 263.089 |

**399,2 gas por carácter**; 11.576 unidades entre el mínimo (3) y el máximo (32) de
longitud permitida.

Esto confirma por un camino independiente la cifra que ya figuraba en la tesina (396 gas
por carácter, ~11.500 de rango), que se había derivado comparando `@bob` con `@alice`.
Aquella derivación era válida porque ambos registros son contemporáneos, pero es frágil
como método: el desplazamiento de línea de base entre fechas distintas es quince veces
mayor que el efecto que se pretende medir. La medición controlada no tiene ese problema.

## 8. Resultado de la demostración

Ejecución completa sobre Polygon (red principal), 12 de septiembre de 2026, contra el
registro `0xEee312ACa2dCdCF372eDD5CE6D58419F6459bA9d`:

| Operación | Hash | Bloque | Gas |
|---|---|---|---|
| Registro `@alice` (billetera de la emisora) | `0xf41ef261f4d5cf4bb2481f46cf723fc3a8b1199228687c607aa7a0ea1664bc8f` | 93.699.091 | 249.167 |
| Registro `@bob` (billetera del receptor) | `0x195170453dc72db3755e11158d1c3ecee7034b18fe8cd9efe3f45cabdee7f42c` | 93.699.095 | 248.375 |
| Blindaje de 0,1 USDC | `0xbf0556c0d1f81b0be759835e21f752f1b77aa61d1254b7a543b978a4fe062e63` | 93.699.109 | 837.732 |
| Transferencia privada de 0,01 USDC | `0x9fadaa20b591ccd35009fd619e54bf21481b30a8e140b760778cc15f4da8e71f` | 93.699.157 | 1.300.681 |

La transferencia se confirmó con `status: 1` y el receptor verificó la recepción desde su
propia billetera (`+0,01 USDC`).

Los dos registros se hicieron con minutos de diferencia sobre el mismo contrato, de modo
que son directamente comparables: **792 unidades de gas de diferencia sobre dos caracteres
de alias, esto es 396 por carácter**, que coincide con la medición controlada de la
sección anterior.

## 9. Correcciones posteriores a la ejecución

Dos defectos del programa se corrigieron **después** de la ejecución registrada arriba, de
modo que la salida capturada no los refleja:

- El proceso terminaba con código 1 tras una corrida exitosa. Al apagar el motor quedaban
  refrescos de POI en vuelo que encontraban la base ya cerrada (`Database is not open`).
  Ahora ese rechazo se ignora, pero sólo una vez iniciado el apagado y sólo para ese error.
- Los balances finales mostraban el saldo de la emisora previo a la transferencia, porque
  se leían sin reescanear. Ahora se refrescan antes de informarlos.
