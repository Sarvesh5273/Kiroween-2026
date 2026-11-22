/**
 * Ambient declarations for the Kiro Crew runtime SDK.
 *
 * `@kirocrew/app-sdk` is not installed from npm. The Kiro Crew host provides it through its import
 * map, so these declarations are the only thing this project holds of it. They cover only the
 * parts `App.tsx` uses. Keep them in step with the SDK version the host ships.
 */
declare module "@kirocrew/app-sdk" {
  /** Client for the host API of the running Kiro Crew app. */
  export interface AppApi {
    get<T = unknown>(path: string): Promise<T>;
    post<T = unknown>(path: string, body?: unknown): Promise<T>;
  }

  export interface AppEvent {
    /** Event name, for example `file.changed`. */
    type: string;
    payload?: unknown;
  }

  /** Returns the host API. It throws when the page runs outside a Kiro Crew host. */
  export function useAppApi(): AppApi;

  /** Calls `handler` for every host event while the component is mounted. */
  export function useAppEvents(handler: (event: AppEvent) => void): void;
}

declare module "@kirocrew/app-sdk/ui" {
  import type { ReactNode } from "react";

  export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

  export interface PageHeaderProps {
    title: string;
    description?: string;
    actions?: ReactNode;
  }
  export function PageHeader(props: PageHeaderProps): ReactNode;

  export interface CardProps {
    title?: string;
    description?: string;
    children?: ReactNode;
  }
  export function Card(props: CardProps): ReactNode;

  export interface StatCardProps {
    label: string;
    value: string | number;
    hint?: string;
  }
  export function StatCard(props: StatCardProps): ReactNode;

  export interface BadgeProps {
    variant?: BadgeVariant;
    children?: ReactNode;
  }
  export function Badge(props: BadgeProps): ReactNode;
}
