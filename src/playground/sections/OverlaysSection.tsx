import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function OverlaysSection() {
  return (
    <section id="overlays" className="rounded-lg border border-border/50 bg-card p-5 space-y-6">
      <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        Overlays
      </h2>

      <div className="flex flex-wrap items-start gap-6">
        {/* Dialog */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Dialog</span>
          <div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">Open Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Sample Dialog</DialogTitle>
                  <DialogDescription>
                    This is a dialog with frosted glass styling and a close button.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter showCloseButton />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Tooltip */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Tooltip</span>
          <div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm">Hover Me</Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                This is a tooltip
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Popover */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Popover</span>
          <div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">Open Popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Popover Content</p>
                  <p className="text-xs text-muted-foreground">
                    This is a popover with frosted glass styling.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Context Menu */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Context Menu</span>
          <div>
            <ContextMenu>
              <ContextMenuTrigger>
                <div className="flex items-center justify-center rounded-md border border-dashed border-border px-6 py-4 text-xs text-muted-foreground select-none">
                  Right-click here
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Edit</ContextMenuItem>
                <ContextMenuItem>Duplicate</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>

        {/* Dropdown Menu */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Dropdown Menu</span>
          <div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">Options</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </section>
  );
}
