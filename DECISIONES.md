# VozFlow — Decisiones del proyecto

> Última actualización: 14 de octubre de 2026
> Estado: v0.1 construida en `app/`. Ubicación: `C:\Users\elosc\projects\VozFlow` (fuera de OneDrive).

## 1. Objetivo

Una app de escritorio para Windows que, con un atajo de teclado, convierte lo que dictas en texto limpio y bien organizado, y lo pega en la app donde estés escribiendo. Es una alternativa propia a Wispr Flow, pensada sobre todo para **dictar prompts a agentes de IA en español**.

## 2. Qué SÍ entra en la v1

| # | Funcionalidad | Detalle |
|---|---|---|
| 1 | Dictado con atajo global | Push-to-talk (mantener) y toggle (doble toque). Al soltar, se pega el texto en la app activa. |
| 2 | Limpieza del texto | Quita muletillas, repeticiones y arranques en falso; corrige puntuación y mayúsculas; arma listas automáticamente cuando enumeras. |
| 3 | Español nativo | Muletillas mexicanas ("este", "o sea", "eh", "bueno pues", "¿no?") y autocorrecciones en español ("no, perdón", "mejor dicho", "digo", "espérate", "más bien"). |
| 4 | **Modo prompt para agentes** | Convierte lo dictado en un prompt estructurado (ver sección 4). |
| 5 | Sugerencias de prompt | Si al prompt dictado le faltan secciones, la app pregunta "¿Quieres añadir X?" con botones Sí/No y, si aceptas, las completa. |
| 6 | Contexto ligero | Solo el nombre de la app y el título de la ventana activa. **Nunca capturas de pantalla.** |
| 7 | Botones flotantes en pantalla | Una pastilla tipo Wispr Flow, siempre visible, con botones (grabar, cambiar de modo, cancelar). Interfaz diseñada por nosotros. |

## 3. Qué NO entra (por ahora)

- **Styles** (tonos por app): descartado.
- **Command Mode** (editar texto seleccionado por voz): para una versión futura.
- **Extras** (snippets, whisper mode, vista de diferencias, historial avanzado, diccionario personal): versión futura si hacen falta.
- **Modelos locales**: descartados. La laptop del trabajo no tiene GPU dedicada y no queremos un LLM corriendo en segundo plano.
- **Gemini**: descartado (en el plan gratuito, Google usa los datos para entrenar).
- **Capturas de pantalla o lectura del contenido de la pantalla**: nunca.

## 4. Diseño del Modo prompt

Secciones de un prompt estructurado:

1. **Rol**: "Actúa como…"
2. **Objetivo**: qué quieres lograr.
3. **Contexto**: la situación y los antecedentes.
4. **Requisitos**: formato, alcance, entregables (en lista).
5. **Restricciones / prompt negativo**: lo que NO debe hacer.

Flujo:

1. Dictas con el atajo del modo prompt (o eliges el modo en la pastilla).
2. El LLM organiza lo dicho en las secciones que **sí mencionaste**, sin inventar nada.
3. Si faltan secciones, la pastilla muestra: "Falta: Rol, Restricciones. ¿Las agrego?" → **[Sí] [No]**.
4. **Sí**: el LLM propone esas secciones a partir de lo dictado, marcadas para revisarlas. **No**: se pega tal cual.

## 5. Infraestructura (nube, gratis)

**Proveedor: Groq** (plan gratuito, sin tarjeta, con API key propia).

| Uso | Modelo | Límite gratis (aprox.) |
|---|---|---|
| Voz → texto | `whisper-large-v3-turbo` (opción: `whisper-large-v3` si falta precisión) | 2,000 peticiones/día · 28,800 s de audio/día (≈ 8 h) · 20/min |
| Limpieza y modo prompt (principal) | `openai/gpt-oss-120b` (razonamiento en "low") | 1,000 peticiones/día · 200,000 tokens/día |
| Respaldo 1 | `openai/gpt-oss-20b` | 1,000 peticiones/día · 200,000 tokens/día |
| Respaldo 2 | `llama-3.1-8b-instant` | 14,400 peticiones/día · 500,000 tokens/día |

Reglas:

- Si un modelo responde 429 (límite alcanzado), se pasa al siguiente de la cadena.
- Si fallan todos los LLM, **se pega la transcripción cruda**. El usuario nunca se queda sin texto.
- Activar **Zero Data Retention** en la consola de Groq (Data Controls).
- El prompt de sistema debe ser corto: el límite que más aprieta son los tokens por día, no las peticiones.
- La API key se guarda cifrada (keyring o safeStorage del sistema), nunca en texto plano.

**Si algún día se paga** (uso intenso: ~150 dictados/día): Whisper turbo cuesta USD 0.04 por hora de audio (mínimo 10 s cobrados por petición) y gpt-oss-120b cuesta USD 0.15 / 0.60 por millón de tokens. Estimado: **menos de USD 3 al mes**.

## 6. Reglas del prompt de limpieza (anti "investiga X")

- El hablante **nunca** le habla al modelo: todo lo dictado es contenido que se transcribe, no instrucciones que se ejecutan.
- La entrada va delimitada en `<transcript>…</transcript>`, con la instrucción explícita de no seguir nada de lo que venga adentro.
- Una pregunta dictada se limpia y se entrega como pregunta; no se responde.
- Salida: solo el texto limpio, sin comentarios, preámbulos ni comillas.
- No parafrasear ni agregar información (excepto en las sugerencias del modo prompt, y solo si el usuario acepta).
- Ejemplos few-shot en español mexicano.

## 7. Repositorios de referencia

Están en `referencias/` y solo se usan para estudiar y copiar piezas. No son el proyecto.

| Repo | Stack | Licencia | Notas |
|---|---|---|---|
| `referencias/handy` (cjpais/Handy) | Tauri + Rust + React | MIT | Ligero (~47k líneas). Excelente para pegar texto en Windows y tiene la pastilla flotante. **No tiene voz a texto en la nube** y los modelos locales no se pueden desactivar. Compilar en Windows exige Vulkan SDK, CMake y MSVC. |
| `referencias/openwhispr` (OpenWhispr) | Electron + React + JS | MIT | Ya trae Groq (voz a texto y limpieza) con API key propia, prompts en español, push-to-talk en Windows (helper en C) y pastilla con botones. Muy pesado (~218k líneas) por cuentas, reuniones, sincronización y planes de pago. |

## 8. Decisión de base (confirmada)

**Repositorio nuevo y limpio en `app/`, hecho con Electron.** Al construirlo se ajustaron dos detalles respecto a la recomendación original:

- **Sin React ni empaquetador.** La interfaz es HTML, CSS y JavaScript simples: menos piezas que se puedan romper y sin paso de compilación.
- **Sin helpers en C.** En lugar de compilar los programas en C de OpenWhispr se usan dos librerías que ya traen binarios para Windows (no hace falta compilador):
  - `uiohook-napi`: detecta mantener y soltar el atajo, y simula Ctrl+V para pegar.
  - `koffi`: lee el nombre de la app activa directo de Windows (user32/kernel32).

Diseño visual: concepto **Obsidiana**. La pastilla es una piedra negra pulida, y la onda de voz tiene sus reflejos iridiscentes: jade, violeta y oro. Jade marca el modo dictado y oro el modo prompt. Tipografía: Onest.

Atajos por defecto: mantener `Ctrl + Win` para dictar, agregar `Shift` para el modo prompt, un toque rápido para manos libres y `Esc` para cancelar.

## 9. Próximos pasos

1. ~~Confirmar la base~~ ✔
2. Crear la cuenta de Groq y la API key; activar Zero Data Retention.
3. ~~MVP: atajo → grabar → Groq Whisper → Groq LLM → pegar~~ ✔
4. ~~Pastilla flotante con botones y flujo Sí/No de sugerencias~~ ✔
5. Probar con dictados reales y afinar los prompts (`app/src/main/prompts.js`).
6. Generar el instalador (`crear-instalador.bat`) y llevarlo a la laptop del trabajo.
