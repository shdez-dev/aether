import { GitFork, ShieldCheck, Users, Route } from "lucide-react";

export const features = [
  {
    icon: GitFork,
    title: "Del porqué al próximo paso.",
    label: "Contexto conectado",
    description:
      "Vincula cada proyecto con la necesidad que lo originó. Entiende qué se busca, qué se decidió y cómo continuar.",
    detail: "La historia acompaña al trabajo, aunque cambien las personas.",
  },
  {
    icon: ShieldCheck,
    title: "Decisiones que se entienden.",
    label: "Criterio compartido",
    description:
      "Reúne evaluaciones, evidencia y acuerdos para que elegir el siguiente paso no dependa de reconstruir conversaciones.",
    detail: "Consulta el fundamento detrás de cada decisión.",
  },
  {
    icon: Users,
    title: "Cada persona sabe dónde aportar.",
    label: "Colaboración con dirección",
    description:
      "Conecta a quienes proponen, evalúan, deciden y ejecutan. Haz visibles las responsabilidades en cada etapa.",
    detail: "Un espacio compartido, con responsabilidades claras.",
  },
  {
    icon: Route,
    title: "Lo acordado llega al día a día.",
    label: "De la intención a la acción",
    description:
      "Organiza proyectos, hitos y tareas sin desconectarlos de su objetivo. Sigue el trabajo y sus bloqueos con contexto.",
    detail: "El siguiente paso tiene un responsable y un propósito.",
  },
] as const;

// Contrast ways of working, without claims about competitors or measured savings.
export const comparisons = [
  [
    "Ideas",
    "Propuestas repartidas entre mensajes",
    "Iniciativas con un punto de partida claro",
  ],
  [
    "Decisiones",
    "Acuerdos difíciles de reconstruir",
    "Fundamentos junto a cada decisión",
  ],
  [
    "Equipo",
    "Responsabilidades que hay que preguntar",
    "Personas y tareas conectadas",
  ],
  [
    "Seguimiento",
    "Volver a pedir contexto para avanzar",
    "El recorrido completo en un mismo lugar",
  ],
] as const;
