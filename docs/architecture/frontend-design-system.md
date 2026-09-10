# Frontend y sistema de diseño

Los tokens de color, espacio y radios viven en `@aether/ui`. Sus componentes base (`Button`, `Field`, `Card`, `Status` y `Notice`) mantienen etiquetas, foco visible, semántica y mensajes de estado accesibles. La interfaz modela de forma explícita los estados de bienvenida, carga, vacío, error y éxito.

La pantalla autenticada requiere un contexto de organización y workspace antes de cargar recursos. La lista y detalle obedecen las acciones autorizadas por la API; presentar una iniciativa conserva el flujo institucional. Testing Library y axe validan los componentes; Playwright cubre carga y presentación con respuestas HTTP controladas.
