# Avisos de componentes de terceros

## JSNES

Arcadia incorpora JSNES 2.0.0, una implementación de NES en JavaScript de Ben Firshman, publicada bajo Apache License 2.0. El archivo distribuido está en `src/vendor/jsnes.min.js`; el texto completo de la licencia está en `JSNES-LICENSE.txt`.

- Proyecto y código fuente: https://github.com/bfirsh/jsnes
- Licencia Apache 2.0: https://www.apache.org/licenses/LICENSE-2.0

## Mesen Community Edition

Arcadia incorpora el ejecutable original de Mesen Community Edition 2.2.1 como proceso independiente para emular las consolas compatibles. Mesen está publicado bajo la GNU General Public License, versión 3 (GPLv3). El binario incluido identifica el commit `20ba206cef5ba207c21203176d02cb9f43dda9fb`; el código fuente correspondiente y los avisos de licencia se encuentran en:

- Código fuente del commit distribuido: https://github.com/nesdev-org/MesenCE/tree/20ba206cef5ba207c21203176d02cb9f43dda9fb
- Licencia GPLv3: https://www.gnu.org/licenses/gpl-3.0.html

Arcadia no copia ni modifica el código fuente de Mesen. La integración de la ventana de juego se hace desde Arcadia en tiempo de ejecución.

## Carátula de muestra de Super Mario Bros.

Arcadia muestra una ilustración local de muestra inspirada en Super Mario Bros. Sus derechos pertenecen a sus titulares.




## EmulatorJS (carga remota opcional para Game Boy Advance)

La versión 1.5.0 carga el reproductor EmulatorJS desde `https://cdn.emulatorjs.org/stable/data/` únicamente cuando el usuario abre el apartado GBA. El código de EmulatorJS y sus núcleos no se distribuyen dentro de este ZIP; se sirven desde su CDN y están sujetos a las licencias y avisos del proyecto correspondiente. Proyecto: https://github.com/EmulatorJS/EmulatorJS. El usuario debe aportar sus propios archivos de juego; Arcadia no incluye ROMs ni BIOS.
