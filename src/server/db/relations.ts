import { relations } from "drizzle-orm";
import {
  addresses,
  cartItems,
  carts,
  categories,
  orderItems,
  orders,
  payments,
  productColors,
  productImages,
  products,
  users,
  variants,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
  orders: many(orders),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  colors: many(productColors),
}));

export const productColorsRelations = relations(productColors, ({ one, many }) => ({
  product: one(products, { fields: [productColors.productId], references: [products.id] }),
  images: many(productImages),
  variants: many(variants),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  color: one(productColors, { fields: [productImages.colorId], references: [productColors.id] }),
}));

export const variantsRelations = relations(variants, ({ one }) => ({
  color: one(productColors, { fields: [variants.colorId], references: [productColors.id] }),
}));

export const cartsRelations = relations(carts, ({ many }) => ({
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(variants, { fields: [cartItems.variantId], references: [variants.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  payments: many(payments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));
