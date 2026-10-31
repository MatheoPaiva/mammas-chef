import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      {/* sm:bottom-16 keeps desktop toasts (and their action buttons, e.g.
          Undo) clear of the bottom-right Sentry feedback widget, which
          renders above z-[100] and otherwise covers the toast's action. */}
      <ToastViewport className="sm:bottom-16" />
    </ToastProvider>
  );
}
