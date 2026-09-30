import type { Product } from "@/features/products/types";

/** The existing product record is the source of truth; live mode keeps only fields it uses. */
export type LiveProduct = Pick<Product, "id" | "title" | "status"> &
  Partial<Pick<Product, "current_price" | "currency" | "image_url">>;

export type LiveActionType =
  | "SPEAK"
  | "SWITCH_PRODUCT"
  | "SHOW_PRODUCT"
  | "PAUSE"
  | "RESUME"
  | "STOP";

export interface LiveAction {
  idempotencyKey: string;
  type: LiveActionType;
  priority: number;
  payload?: Readonly<Record<string, string | number | boolean | null>>;
}
