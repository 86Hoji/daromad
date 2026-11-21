// Каскадное появление панелей: подъём + проявление с пружиной, задержка по индексу. Только transform/opacity.
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function Rise({ i = 0, className = "", children, id, as = "div" }: { i?: number; className?: string; children: ReactNode; id?: string; as?: "div" | "section" }) {
  const reduce = useReducedMotion();
  const Tag = as === "section" ? motion.section : motion.div;
  return (
    <Tag
      id={id}
      className={className}
      initial={reduce ? false : { opacity: 0, y: 34, scale: 0.975 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 20, mass: 0.9, delay: 0.08 + i * 0.09 }}
      style={{ willChange: "transform, opacity" }}
    >
      {children}
    </Tag>
  );
}
