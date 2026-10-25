import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "relative inline-flex min-h-11 items-center justify-center border px-4 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:border-control-border disabled:bg-surface-muted disabled:text-text-muted aria-disabled:pointer-events-none aria-disabled:border-control-border aria-disabled:bg-surface-muted aria-disabled:text-text-muted",
  {
    variants: {
      variant: {
        primary: "button-primary rounded-sm border-transparent bg-brand text-brand-foreground uppercase tracking-wider",
        secondary: "button-secondary rounded-full border-transparent bg-transparent text-foreground",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

type ButtonProps = ComponentPropsWithRef<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    children: ReactNode;
  };

// Button shares semantic control styling and forwards React 19 refs through props.
function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export { Button, buttonVariants };
