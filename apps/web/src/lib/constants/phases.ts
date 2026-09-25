import {
  Lightbulb,
  ScanSearch,
  ClipboardCheck,
  Scale,
  FolderKanban,
  ListChecks,
} from "lucide-react";

export const phases = [
  {
    id: "iniciativa",
    number: "01",
    name: "Iniciativa",
    icon: Lightbulb,
    color: "var(--phase-1)",
    description:
      "Dale un punto de partida a la necesidad. Define el problema, el resultado esperado y su contexto.",
    roles: ["Solicitante", "Admin", "Owner"],
    output: "Una propuesta que todos pueden entender",
    example:
      "Un equipo propone reducir los tiempos de atención y registra el problema antes de comprometer recursos.",
  },
  {
    id: "diagnostico",
    number: "02",
    name: "Diagnóstico",
    icon: ScanSearch,
    color: "var(--phase-2)",
    description:
      "Construye una visión compartida del problema, sus causas y la evidencia disponible.",
    roles: ["Solicitante", "Colaboradores"],
    output: "Contexto y evidencia documentados",
    example:
      "El equipo reúne datos sobre esperas, identifica las causas y vincula evidencia a la iniciativa.",
  },
  {
    id: "evaluacion",
    number: "03",
    name: "Evaluación",
    icon: ClipboardCheck,
    color: "var(--phase-3)",
    description:
      "Compara el valor y la viabilidad de cada propuesta con criterios compartidos y evidencia a la vista.",
    roles: ["Revisor asignado"],
    output: "Más claridad para elegir el siguiente paso",
    example:
      "La persona revisora contrasta la propuesta con criterios de viabilidad e impacto y deja hallazgos verificables.",
  },
  {
    id: "decision",
    number: "04",
    name: "Decisión",
    icon: Scale,
    color: "var(--phase-4)",
    description:
      "Decide qué avanza, qué necesita ajustes y por qué. Deja el acuerdo claro para quienes continuarán el trabajo.",
    roles: ["Owner"],
    output: "Decisión y condiciones registradas",
    example:
      "La dirección aprueba la mejora y acuerda quién la liderará y qué recursos necesita para comenzar.",
  },
  {
    id: "proyecto",
    number: "05",
    name: "Proyecto",
    icon: FolderKanban,
    color: "var(--phase-5)",
    description:
      "Transforma una iniciativa aprobada en un proyecto con alcance, responsables e hitos claros.",
    roles: ["Owner", "Admin", "Líder"],
    output: "Un plan conectado con su propósito",
    example:
      "El equipo prepara el proyecto de mejora con un objetivo compartido, sin volver a reconstruir la historia de la propuesta.",
  },
  {
    id: "tareas",
    number: "06",
    name: "Tareas",
    icon: ListChecks,
    color: "var(--phase-6)",
    description:
      "Lleva los acuerdos al trabajo diario. Coordina tareas, fechas y bloqueos sin perder su origen.",
    roles: ["Líder", "Participantes"],
    output: "Trabajo ejecutable y seguimiento",
    example:
      "El líder organiza la implementación, asigna tareas al equipo y sigue los bloqueos hasta el cierre.",
  },
] as const;

export type Phase = (typeof phases)[number];
