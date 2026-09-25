import { Users, Compass, Route } from "lucide-react";

export const actors = [
  {
    id: "equipos",
    name: "Equipos que proponen",
    icon: Users,
    color: "var(--phase-1)",
    purpose: "Dale un camino a lo que podría mejorar.",
    capabilities: [
      "Convierte necesidades en propuestas",
      "Reúne el contexto y la evidencia",
      "Sigue el recorrido de tu iniciativa",
    ],
  },
  {
    id: "direccion",
    name: "Personas que deciden",
    icon: Compass,
    color: "var(--phase-3)",
    purpose: "Mira más allá de una solicitud aislada.",
    capabilities: [
      "Consulta evaluaciones y fundamentos",
      "Define qué avanza y bajo qué condiciones",
      "Conserva la historia de los acuerdos",
    ],
  },
  {
    id: "lideres",
    name: "Líderes que hacen avanzar",
    icon: Route,
    color: "var(--phase-5)",
    purpose: "Conecta el propósito con el trabajo diario.",
    capabilities: [
      "Organiza proyectos con objetivos claros",
      "Coordina responsables, hitos y tareas",
      "Identifica bloqueos sin perder el contexto",
    ],
  },
] as const;
