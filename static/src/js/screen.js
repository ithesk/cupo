odoo.define('pos_coupon.models', function (require) {
    'use strict';

    var models = require('point_of_sale.models');
    var rpc = require('web.rpc');
    var core = require('web.core');
    var _t = core._t;


      // Extender los campos que se cargan para los productos
    models.load_fields('product.product', [
        'available_in_pos',
        'type',
        'list_price',
        'taxes_id',
        'uom_id',
        'pos_categ_id',
        'categ_id'
    ]);
    
     // Cargar el modelo de categorías de producto
     models.load_models([{
        model: 'product.category',
        fields: ['name', 'parent_id'],
        domain: null,
        loaded: function(self, categories) {
            self.product_categories = categories;
            // Crear un mapa de categorías por ID para búsqueda rápida
            self.product_categories_by_id = {};
            categories.forEach(function(category) {
                self.product_categories_by_id[category.id] = category;
            });
        }
    }]);

    // Extender el modelo POS base
    var _super_posmodel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        initialize: function(session, attributes) {
            var self = this;
            // Llamar al método original de inicialización
            _super_posmodel.initialize.apply(this, arguments);
            
            // Agregar nuevo modelo para cupones
            this.models.push({
                model: 'pos.coupon',
                fields: ['name', 'amount', 'state', 'order_id', 'used_in_order'],
                domain: function(self) {
                    return [['state', '=', 'valid']];
                },
                loaded: function(self, coupons) {
                    self.coupons = coupons;
                },
            });
        },
        
        // Método para guardar órdenes en el servidor
// DESPUÉS (código con logs):
_save_to_server: function (orders, options) {
    var self = this;
    console.log('1. Enviando órdenes al servidor:', orders);

    return _super_posmodel._save_to_server.apply(this, arguments)
        .then(function(server_ids) {
            console.log('2. Respuesta del servidor:', server_ids);
            
            if (Array.isArray(server_ids)) {
                server_ids.forEach(function(server_data) {
                    // Verificar si hay datos de cupón
                    if (server_data && server_data.generated_coupon_data) {
                        var order = self.get_order();
                        if (order) {
                            console.log('3. Actualizando orden con cupón:', 
                                server_data.generated_coupon_data);
                            order.generated_coupon_data = server_data.generated_coupon_data;
                            order.trigger('change', order);
                        }
                    }
                });
            } else if (server_ids && server_ids.generated_coupon_data) {
                // Si es una única orden
                var order = self.get_order();
                if (order) {
                    console.log('3. Actualizando orden única con cupón:', 
                        server_ids.generated_coupon_data);
                    order.generated_coupon_data = server_ids.generated_coupon_data;
                    order.trigger('change', order);
                }
            }
            
            return server_ids;

                });
        }, 
    });

    
    // Extender el modelo de producto
    var _super_product = models.Product.prototype;
    models.Product = models.Product.extend({
        initialize: function(attr, options) {
            _super_product.initialize.apply(this, arguments);
            this.available_in_pos = this.available_in_pos || false;
            this.type = this.type || 'product';
        }
    });



    
    // Extender el modelo de línea de orden
    var _super_orderline = models.Orderline.prototype;
    models.Orderline = models.Orderline.extend({
        initialize: function(attr, options) {
            _super_orderline.initialize.apply(this, arguments);
            this.coupon_id = this.coupon_id || false;
            this.is_coupon_line = this.is_coupon_line || false;
        },
        
        init_from_JSON: function(json) {
            _super_orderline.init_from_JSON.apply(this, arguments);
            this.coupon_id = json.coupon_id;
            this.is_coupon_line = json.is_coupon_line;
        },
        
        export_as_JSON: function() {
            var json = _super_orderline.export_as_JSON.apply(this, arguments);
            json.coupon_id = this.coupon_id;
            json.is_coupon_line = this.is_coupon_line;
            return json;
        },
        
        get_coupon_data: function() {
            return this.coupon_id;
        },

        set_coupon: function(coupon_id) {
            this.coupon_id = coupon_id;
            this.is_coupon_line = true;
            if (this.order) {
                this.order.applied_coupon_id = coupon_id;
                this.order.coupon_to_update_id = coupon_id;
            }
            this.trigger('change', this);
        },
        
        clone: function() {
            var orderline = _super_orderline.clone.apply(this, arguments);
            orderline.coupon_id = this.coupon_id;
            orderline.is_coupon_line = this.is_coupon_line;
            return orderline;
        },
        
        can_be_merged_with: function(orderline) {
            if (this.is_coupon_line || orderline.is_coupon_line) {
                return false;
            }
            return _super_orderline.can_be_merged_with.apply(this, arguments);
        }
    });

    // Extender el modelo de orden
    var _super_order = models.Order.prototype;
    models.Order = models.Order.extend({
        initialize: function(attributes, options) {
            _super_order.initialize.apply(this, arguments);
            this.applied_coupon_id = this.applied_coupon_id || false;
            this.generated_coupon_id = this.generated_coupon_id || false;
            this.generated_coupon_data = this.generated_coupon_data || false;
        },

           // Sobrescribir el método que maneja la respuesta del servidor
        set_order_id: function(order_id) {
            _super_order.set_order_id.apply(this, arguments);
            
            var self = this;
            var orders = this.pos.db.get_orders();
            var order = orders.find(function(order) {
                return order.id === order_id;
            });
            
            if (order && order.generated_coupon_data) {
                this.generated_coupon_data = order.generated_coupon_data;
                this.trigger('change', this);
            }
        },

        add_product: function(product, options) {
            console.log('1. Inicio add_product:', {
                product_id: product.id,
                product_name: product.display_name || product.name,
                options: options
            });
    
            // Si es una línea de descuento, asegurarnos de que el precio sea negativo
            if (product.id === this.pos.config.discount_product_id[0]) {
                options = options || {};
                if (!options.price) {
                    options.price = -Math.abs(product.lst_price);
                }
                options.merge = false;  // Nunca combinar líneas de descuento
            }
    
            var line = _super_order.add_product.apply(this, arguments);
            
            console.log('2. Resultado de add_product:', {
                success: !!line,
                line_id: line ? line.cid : null,
                line_price: line ? line.get_unit_price() : null
            });
    
            return line;
        },

        add_orderline: function(line) {
            if (line.coupon_id) {
                // Verificar si ya existe una línea con cupón
                var existing_coupon_line = this.get_orderlines().find(function(l) {
                    return l.coupon_id;
                });
                if (existing_coupon_line) {
                    this.remove_orderline(existing_coupon_line);
                }
            }
            return _super_order.add_orderline.apply(this, arguments);
        },
        
        // Este método se llama cuando se exporta la orden para enviarla al backend
       export_as_JSON: function() {
        var json = _super_order.export_as_JSON.apply(this, arguments);
        json.generated_coupon_id = this.generated_coupon_id;
        json.generated_coupon_data = this.generated_coupon_data;
        
        // Incluir información del cupón
        if (this.applied_coupon_id) {
            json.applied_coupon_id = this.applied_coupon_id;
            // Incluir el uid de la orden para referencia
            json.order_uid = this.uid;
        }

        console.log('Datos de orden a enviar:', {
            name: json.name,
            uid: json.uid,
            coupon_id: json.applied_coupon_id
        });

        return json;
    },
        
        init_from_JSON: function(json) {
            _super_order.init_from_JSON.apply(this, arguments);
            console.log('Datos de orden recibidos del backend:', json);
            this.applied_coupon_id = json.applied_coupon_id;
            this.coupon_to_update_id = json.coupon_to_update_id;
        },

        export_for_printing: function() {
            var receipt = _super_order.export_for_printing.apply(this, arguments);
            console.log('8. Preparando datos para el recibo:', {
                has_coupon_data: !!this.generated_coupon_data,
                coupon_data: this.generated_coupon_data
            });
            
            if (this.generated_coupon_data) {
                receipt.generated_coupon = {
                    code: this.generated_coupon_data.name,
                    amount: this.generated_coupon_data.amount
                };
                console.log('9. Datos de cupón añadidos al recibo:', receipt.generated_coupon);
            }
            
            console.log('10. Recibo completo:', receipt);
            return receipt;
        },

        get_coupon_lines: function() {
            return this.get_orderlines().filter(function(line) {
                return line.get_coupon_data && line.get_coupon_data();
            });
        },

        has_coupon_applied: function() {
            return this.get_coupon_lines().length > 0;
        },

        get_total_without_coupons: function() {
            var total = 0;
            this.get_orderlines().forEach(function(line) {
                if (!line.is_coupon_line) {
                    total += line.get_price_with_tax();
                }
            });
            return total;
        },

        validateOrder: function(force_validation) {
            var self = this;
             // Si hay cupón aplicado
        if (this.applied_coupon_id) {
            console.log('Actualizando estado del cupón para orden:', this.name);
            
            // Buscar primero la orden por nombre
            rpc.query({
                model: 'pos.order',
                method: 'search_read',
                args: [[['name', '=', this.name]], ['id']],
                kwargs: {limit: 1}
            }).then(function(orders) {
                if (orders && orders.length > 0) {
                    // Actualizar el cupón con el ID de la orden
                    return rpc.query({
                        model: 'pos.coupon',
                        method: 'mark_as_used',
                        args: [[self.applied_coupon_id], orders[0].id]
                    });
                }
            }).then(function(result) {
                console.log('Cupón actualizado:', result);
            }).catch(function(error) {
                console.error('Error al actualizar cupón:', error);
            });
        }
        
        return _super_order.validateOrder.apply(this, arguments);
    },
    

        apply_coupon: function(coupon_data) {
            var line = this.get_coupon_lines()[0];
            if (line) {
                line.set_coupon(coupon_data.id);
                this.applied_coupon_id = coupon_data.id;
                this.coupon_to_update_id = coupon_data.id;
                
                console.log('Cupón aplicado:', {
                    id: coupon_data.id,
                    line_id: line.id,
                    order_id: this.uid,
                    amount: line.get_price_with_tax()
                });
                
                this.trigger('change', this);
            }
        },

        remove_coupon: function() {
            var coupon_line = this.get_coupon_lines()[0];
            if (coupon_line) {
                this.remove_orderline(coupon_line);
                this.applied_coupon_id = false;
                this.coupon_to_update_id = false;
                this.trigger('change', this);
            }
        }
    });

    // Cargar campos adicionales
    models.load_fields('pos.order', [
        'applied_coupon_id',
        'generated_coupon_id',
        'coupon_to_update_id'
    ]);

    models.load_fields('pos.order.line', [
        'coupon_id',
        'is_coupon_line'
    ]);
});