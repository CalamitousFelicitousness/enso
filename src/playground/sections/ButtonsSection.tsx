import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";

const buttonVariants = [
  "default",
  "destructive",
  "destructive-soft",
  "outline",
  "secondary",
  "ghost",
  "link",
  "toggle",
] as const;

const textSizes = ["xs", "sm", "default", "lg"] as const;
const iconSizes = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;

const badgeVariants = [
  "default",
  "secondary",
  "destructive",
  "outline",
  "ghost",
  "link",
] as const;

export function ButtonsSection() {
  return (
    <section id="buttons" className="rounded-lg border border-border/50 bg-card p-5 space-y-6">
      <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        Buttons
      </h2>

      {/* Text buttons: variants x sizes */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">
          Variants x Sizes
        </span>

        <div className="space-y-3">
          {buttonVariants.map((variant) => (
            <div key={variant} className="flex items-center gap-3">
              <span className="text-3xs text-muted-foreground/60 w-28 shrink-0 text-right">
                {variant}
              </span>
              {variant === "toggle" ? (
                <>
                  {textSizes.map((size) => (
                    <div key={size} className="flex items-center gap-1.5">
                      <Button variant="toggle" size={size}>
                        {size}
                      </Button>
                      <Button variant="toggle" size={size} data-state="on">
                        {size}
                      </Button>
                    </div>
                  ))}
                </>
              ) : (
                textSizes.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    {size}
                  </Button>
                ))
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Icon buttons: variants x icon sizes */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">
          Icon Sizes
        </span>

        <div className="space-y-3">
          {buttonVariants.map((variant) => (
            <div key={variant} className="flex items-center gap-3">
              <span className="text-3xs text-muted-foreground/60 w-28 shrink-0 text-right">
                {variant}
              </span>
              {variant === "toggle" ? (
                <>
                  {iconSizes.map((size) => (
                    <div key={size} className="flex items-center gap-1.5">
                      <Button variant="toggle" size={size}>
                        <Plus />
                      </Button>
                      <Button variant="toggle" size={size} data-state="on">
                        <Plus />
                      </Button>
                    </div>
                  ))}
                </>
              ) : (
                iconSizes.map((size) => (
                  <Button
                    key={size}
                    variant={variant}
                    size={size}
                  >
                    {variant === "destructive" || variant === "destructive-soft" ? (
                      <Trash2 />
                    ) : (
                      <Plus />
                    )}
                  </Button>
                ))
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Disabled state */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">
          Disabled
        </span>

        <div className="flex items-center gap-3">
          <span className="text-3xs text-muted-foreground/60 w-28 shrink-0 text-right">
            default
          </span>
          {textSizes.map((size) => (
            <Button key={size} variant="default" size={size} disabled>
              {size}
            </Button>
          ))}
        </div>
      </div>

      {/* Badges */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">
          Badge
        </span>

        <div className="flex items-center gap-3">
          {badgeVariants.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}
