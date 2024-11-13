odoo.define('pos_coupon.screens', function(require) {
    'use strict';

    var screens = require('point_of_sale.screens');
    var gui = require('point_of_sale.gui');
    var core = require('web.core');
    require('pos_coupon.models');
    var rpc = require('web.rpc');
    var _t = core._t;
    var models = require('point_of_sale.models');

    // Botón de Cupón
    var CouponButton = screens.ActionButtonWidget.extend({
        template: 'CouponButton',
        
        button_click: function() {
            var self = this;
            var order = this.pos.get_order();
            console.log('Click en botón de cupón', order);
            
            if (!order) {
                console.log('No hay orden activa');
                return;
            }

            if (order.get_coupon_lines().length > 0) {
                this.gui.show_popup('error', {
                    'title': _t('Error'),
                    'body': _t('Ya hay un cupón aplicado a esta orden'),
                });
                return;
            }

            this.gui.show_popup('textinput', {
                'title': _t('Ingresar Código de Cupón'),
                'confirm': function(code) {
                    console.log('Código de cupón ingresado:', code);
                    if (code) {
                        self._validateCoupon(code);
                    }
                },
            });
        },

        _validateCoupon: function(code) {
            var self = this;
            console.log('Validando cupón:', code);
            
            // Verificar que rpc está disponible
            console.log('RPC disponible:', rpc);
            
            // Construir la llamada RPC
            var params = {
                model: 'pos.coupon',
                method: 'search_read',
                args: [],
                kwargs: {
                    domain: [['name', '=', code], ['state', '=', 'valid']],
                    fields: ['id', 'amount', 'name']
                }
            };
            
            console.log('Parámetros RPC:', params);

            // Realizar la llamada RPC con manejo de promesa
            rpc.query(params).done(function(coupons) {
                console.log('Respuesta de validación:', coupons);
                if (!coupons || coupons.length === 0) {
                    console.log('Cupón no encontrado o inválido');
                    self.gui.show_popup('error', {
                        'title': _t('Error'),
                        'body': _t('Cupón inválido o ya utilizado'),
                    });
                    return;
                }
                
                var coupon = coupons[0];
                console.log('Cupón encontrado:', coupon);
                self._applyCoupon(coupon);
            }).fail(function(error){
                console.error('Error al validar cupón:', error);
                self.gui.show_popup('error', {
                    'title': _t('Error'),
                    'body': _t('Error al validar el cupón: ' + (error.data ? error.data.message : error.message)),
                });
            });
        },

        _findDiscountProduct: function() {
            var self = this;
            // Primero intentamos obtener el producto configurado
            var discount_product = null;
            
            if (this.pos.config.discount_product_id && this.pos.config.discount_product_id[0]) {
                discount_product = this.pos.db.get_product_by_id(this.pos.config.discount_product_id[0]);
            }
            
            // Si no encontramos el producto configurado, buscamos por nombre
            if (!discount_product) {
                var all_products = this.pos.db.product_by_id;
                for (var id in all_products) {
                    var product = all_products[id];
                    if (product.display_name === 'Descuento Cupón') {
                        discount_product = product;
                        break;
                    }
                }
            }
            
            return discount_product;
        },

                // Método auxiliar para verificar categorías generales
        _checkGeneralCategory: function(product) {
            if (!product.categ_id) return false;
            
            var eligibleCategories = ['servicios', 'accesorios'];
            var currentCategory = product.categ_id;
            
            // Función recursiva para verificar la jerarquía de categorías
            var checkCategoryHierarchy = function(category_id) {
                if (!category_id) return false;
                
                var category = this.pos.product_categories_by_id[category_id];
                if (!category) return false;
                
                // Verificar el nombre de la categoría actual
                if (eligibleCategories.includes(category.name.toLowerCase())) {
                    return true;
                }
                
                // Verificar categoría padre si existe
                return category.parent_id ? checkCategoryHierarchy(category.parent_id[0]) : false;
            }.bind(this);
            
            return checkCategoryHierarchy(currentCategory[0]);
        },

        _applyCoupon: function(coupon) {
            var order = this.pos.get_order();
            console.log('Aplicando cupón:', coupon);
        
            try {
                // Obtener producto de descuento
                var discount_product = this.pos.db.get_product_by_id(this.pos.config.discount_product_id[0]);
                if (!discount_product) {
                    throw new Error('Producto de descuento no configurado');
                }
        
                // Calcular descuento
                var eligibleAmount = this._getEligibleAmount(order);
                var discount = Math.min(coupon.amount, eligibleAmount);
        
                // Crear línea de descuento
                var orderlines = order.get_orderlines();
                var OrderLine = orderlines[0].constructor;
                var line = new OrderLine({}, {
                    pos: this.pos,
                    order: order,
                    product: discount_product
                });
        
                // Configurar línea
                line.set_quantity(1);
                line.set_unit_price(-discount);
                
                // Guardar referencia al cupón
                order.applied_coupon_id = coupon.id;
                line.coupon_id = coupon.id;
                
                // Añadir línea a la orden
                order.orderlines.add(line);
        
                // Debug
                console.log('Cupón aplicado:', {
                    order_id: order.id,
                    coupon_id: coupon.id,
                    line_price: line.get_unit_price(),
                    total_lines: order.get_orderlines().length
                });
        
                // Actualizar UI
                order.trigger('change', order);
        
                return line;
        
            } catch (error) {
                console.error('Error al aplicar cupón:', error);
                return false;
            }
        },

        _getEligibleAmount: function(order) {
            var self = this;
            var total = 0;
            var eligiblePosCategories = ['Servicios', 'Accesorios'];
            var eligibleGeneralCategories = ['servicios', 'accesorios'];
            
            order.get_orderlines().forEach(function(line) {
                var product = line.product;
                console.log('Verificando línea:', product.display_name);
                
                // Verificar categoría POS
                var isPosEligible = product.pos_categ_id && 
                    eligiblePosCategories.includes(product.pos_categ_id[1]);
                
                // Verificar categoría general
                var isGeneralEligible = self._checkGeneralCategory(product);
                
                console.log('Elegibilidad:', {
                    producto: product.display_name,
                    pos_category: product.pos_categ_id ? product.pos_categ_id[1] : 'Sin categoría POS',
                    general_category: product.categ_id ? product.categ_id[1] : 'Sin categoría general',
                    isPosEligible: isPosEligible,
                    isGeneralEligible: isGeneralEligible
                });
                
                // La línea es elegible si cumple con cualquiera de las dos condiciones
                if (isPosEligible || isGeneralEligible) {
                    var lineTotal = line.get_price_with_tax();
                    console.log('Línea elegible, monto:', lineTotal);
                    total += lineTotal;
                }
            });
            
            console.log('Total elegible:', total);
            return total;
        }
    });

 
    // Resto del código...

    screens.define_action_button({
        'name': 'coupon',
        'widget': CouponButton,
        'condition': function() {
            return true;
        },
    });

    return {
        CouponButton: CouponButton,
    };
});
