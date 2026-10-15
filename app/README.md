# VozFlow

Dictado por voz para Windows. Mantienes un atajo, hablas, sueltas, y el texto aparece limpio en la app donde tengas el cursor. Con Shift, lo que dices se convierte en un prompt estructurado para agentes de IA.

## Usarlo

1. Doble clic en **`iniciar.bat`**. La primera vez instala todo (tarda un par de minutos y necesita internet).
2. Se abre la ventana de VozFlow: pega tu API key de Groq en **Conexión** y presiona **Guardar**.
3. Pon el cursor en cualquier app y usa los atajos.

| Atajo | Qué hace |
|---|---|
| Mantener `Ctrl + Win` | Dictado: graba mientras lo mantienes y pega texto limpio al soltar |
| Toque rápido `Ctrl + Win` | Manos libres: vuelve a tocarlo para terminar |
| Mantener `Ctrl + Win + Shift` | Prompt: ordena lo dicho en rol, objetivo, contexto, requisitos y restricciones |
| `Esc` | Cancela |

VozFlow vive en la bandeja del sistema (junto al reloj). Desde ahí abres los ajustes o lo cierras.

**Requisito:** Node.js 22.12 o más nuevo (https://nodejs.org, versión LTS). Solo hace falta en la computadora donde se arma; la laptop del trabajo puede usar el instalador.

## Instalador para otra computadora

Doble clic en **`crear-instalador.bat`**. Deja el archivo `dist\VozFlow Setup 0.1.0.exe`. Cópialo a la laptop e instálalo. Como el instalador no está firmado, Windows puede mostrar "Windows protegió tu PC": elige **Más información → Ejecutar de todas formas**.

## Cómo está hecho

```
src/main/main.js      Orquesta todo: ventanas, bandeja, flujo de dictado
src/main/hotkeys.js   Atajos globales (uiohook): mantener, tocar, Shift, Esc
src/main/groq.js      Groq: Whisper (voz a texto) y LLM con modelos de respaldo
src/main/prompts.js   Prompts de limpieza, modo prompt y sugerencias  ← aquí se afina la calidad
src/main/context.js   Nombre de la app activa (Windows), sin capturas
src/main/paste.js     Pegar con Ctrl+V y restaurar el portapapeles
src/main/store.js     Ajustes, API key cifrada e historial (%APPDATA%\VozFlow)
src/renderer/pill     La pastilla flotante (grabación, onda, sugerencias)
src/renderer/settings La ventana de ajustes
```

Para desarrollar: `npm install` y luego `npm start`.
