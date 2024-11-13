# -*- coding: utf-8 -*-
from odoo import models, fields, api
import random
import string
import logging
import requests  # Asegúrate de que requests esté importado
from odoo.exceptions import UserError  # Importar UserError
from datetime import timedelta  # Importar timedelta

_logger = logging.getLogger(__name__)

class POSConfig(models.Model):
    _inherit = 'pos.config'

    discount_product_id = fields.Many2one(
        'product.product',
        string='Producto Descuento Cupón',
        domain=[('type', '=', 'service')],
        help='Producto usado para aplicar descuentos de cupones'
    )

    @api.model
    def create_discount_product(self):
        """Crear producto de descuento si no existe"""
        product = self.env['product.product'].search([
            ('name', '=', 'Descuento Cupón'),
            ('type', '=', 'service')
        ], limit=1)
        
        if not product:
            product = self.env['product.product'].create({
                'name': 'Descuento Cupón',
                'type': 'service',
                'list_price': 0.0,
                'sale_ok': True,
                'purchase_ok': False,
                'available_in_pos': True,
            })
        
        return product

class POSCoupon(models.Model):
    _name = 'pos.coupon'
    _description = 'Cupones POS'

    name = fields.Char('Código del Cupón', required=True, readonly=True)
    order_id = fields.Many2one('pos.order', 'Orden Generadora')
    amount = fields.Float('Monto del Descuento', required=True)
    state = fields.Selection([
        ('valid', 'Válido'),
        ('used', 'Usado'),
        ('expired', 'Expirado')
    ], string='Estado', default='valid')
    used_in_order = fields.Many2one('pos.order', 'Usado en Orden')
    creation_date = fields.Datetime('Fecha de Creación', default=fields.Datetime.now)

    def write(self, vals):
        """Sobrescribir write para manejar la actualización del estado"""
        _logger.info('Actualizando cupón con valores: %s', vals)
        
        # Si se está actualizando used_in_order
        if 'used_in_order' in vals:
            order_reference = vals['used_in_order']
            
            # Si es una cadena (nombre de la orden), buscar el ID
            if isinstance(order_reference, str):
                order = self.env['pos.order'].search([
                    ('name', '=', order_reference)
                ], limit=1)
                
                if order:
                    vals['used_in_order'] = order.id
                    _logger.info('Orden encontrada con ID: %s', order.id)
                else:
                    _logger.error('Orden no encontrada para referencia: %s', order_reference)
                    vals['used_in_order'] = False

        return super(POSCoupon, self).write(vals)

    def mark_as_used(self, order_id):
        self.ensure_one()
        _logger.info('Marcando cupón %s como usado en orden %s', self.name, order_id)
        if isinstance(order_id, str):
            # Si recibimos un nombre de orden, buscar su ID
            order = self.env['pos.order'].search([('name', '=', order_id)], limit=1)
            if order:
                order_id = order.id
            else:
                return False
        
        return self.write({
            'state': 'used',
            'used_in_order': order_id
        })
    

    @api.model
    def generate_coupon_code(self):
        _logger.info('Generando código de cupón')
        chars = string.ascii_uppercase + string.digits
        return ''.join(random.choice(chars) for _ in range(8))
    
    @api.model
    def _generate_code(self):
        """Generar código único para cupón"""
        while True:
            code = ''.join(random.choice(string.ascii_uppercase + string.digits) 
                         for _ in range(8))
            if not self.search_count([('name', '=', code)]):
                return code

    @api.model
    def create_from_pos_order(self, order_id, amount):
        """Crear cupón desde orden POS"""
        if isinstance(order_id, str):
            order = self.env['pos.order'].search([
                '|',
                ('name', '=', order_id),
                ('uid', '=', order_id)
            ], limit=1)
            if order:
                order_id = order.id

        return self.create({
            'name': coupon_code,
            'order_id': order_id,
            'amount': amount,
            'state': 'valid'
        })
    

    @api.model
    def validate_and_use(self, code, order_name):
        """Validar y marcar cupón como usado"""
        _logger.info('Validando y usando cupón %s para orden %s', code, order_name)
        coupon = self.search([
            ('name', '=', code),
            ('state', '=', 'valid')
        ], limit=1)
        
        if coupon:
            _logger.info('Cupón encontrado, marcando como usado')
            coupon.mark_as_used(order_name)
            return {
                'success': True,
                'coupon': {
                    'id': coupon.id,
                    'name': coupon.name,
                    'amount': coupon.amount
                }
            }
        _logger.warning('Cupón no encontrado o no válido: %s', code)
        return {
            'success': False,
            'error': 'Cupón no encontrado o no válido'
        }

    @api.model
    def search_read(self, domain=None, fields=None, offset=0, limit=None, order=None):
        """Sobrescribir search_read para procesar búsquedas de cupones"""
        result = super(POSCoupon, self).search_read(
            domain=domain, fields=fields, offset=offset, 
            limit=limit, order=order)
        
        # Si estamos buscando un cupón específico por nombre
        if domain and any(x[0] == 'name' for x in domain):
            coupon_name = next(x[2] for x in domain if x[0] == 'name')
            _logger.info('Búsqueda de cupón específico: %s', coupon_name)
            
            # Si encontramos resultados y es una validación de cupón
            if result and any(x[0] == 'state' and x[2] == 'valid' for x in domain):
                coupon = self.browse(result[0]['id'])
                _logger.info('Validando cupón %s con estado: %s', 
                           coupon.name, coupon.state)
        
        return result

class POSOrder(models.Model):
    _inherit = 'pos.order'

    generated_coupon_id = fields.Many2one('pos.coupon', 'Cupón Generado')
    applied_coupon_id = fields.Many2one('pos.coupon', 'Cupón Aplicado')


    @api.model
    def whatsapp_cupon(self, phone, message):
        _logger.info(f"Enviando cupon por WhatsApp: {phone} - {message}") # Loggear el mensaje
        _logger.info(f"phone es : {phone}") # Loggear el mensaje
        url = "http://192.168.2.148:3005/send-message"  # El número ya fue validado y limpiado
        data = {
            "phone": phone,
            "message": message,
            "mediaUrl": "http://imgfz.com/i/uIbGPDF.png",
        }
        _logger.info(f"Enviando cupon por WhatsApp: {data}")

        # Captura de errores al enviar el mensaje
        try:
            response = requests.post(url, json=data)
            response.raise_for_status()

            # Verificar si la respuesta es JSON
            content_type = response.headers.get('Content-Type')
            if content_type and 'application/json' in content_type:
                try:
                   return response.json()  # Intentar decodificar la respuesta como JSON
                except ValueError:
                   _logger.error(f"La respuesta no es un JSON válido: {response.text}")
                   raise UserError("Error al procesar la respuesta del servidor de WhatsApp.")
            else:
               _logger.info(f"Respuesta de texto del servidor: {response.text}")
               return response.text  # Devolver el texto como está, si es una respuesta válida
           
        except requests.exceptions.RequestException as e:
            _logger.error(f"Error al enviar el mensaje por WhatsApp: {e}")
            raise UserError("Error al enviar el mensaje por WhatsApp.")

    @api.model
    def _order_fields(self, ui_order):
        """Método que recibe los datos del frontend"""
        _logger.info('Recibiendo datos de orden del frontend: %s', ui_order)
        
        fields = super(POSOrder, self)._order_fields(ui_order)
        
        # Procesar cupón si existe
        if ui_order.get('applied_coupon_id'):
            fields['applied_coupon_id'] = ui_order['applied_coupon_id']
            _logger.info('Cupón detectado en orden')
        
        return fields

    @api.model
    def create_from_ui(self, orders):
        """Método principal para crear órdenes desde el UI"""
        _logger.info('1. Iniciando create_from_ui con órdenes: %s', len(orders))
        
        # 1. Crear las órdenes normalmente
        order_ids = super(POSOrder, self).create_from_ui(orders)
        _logger.info('2. Resultado del super().create_from_ui: %s', order_ids)
        
        # 2. Convertir IDs a formato correcto
        result = []
        process_ids = order_ids if isinstance(order_ids, list) else [order_ids]
        _logger.info('3. IDs a procesar: %s', process_ids)

        # 3. Procesar cada orden
        for oid in process_ids:
            # Convertir el ID a diccionario si es necesario
            current_id = oid if isinstance(oid, int) else oid.get('id')
            order_data = {'id': current_id}
            _logger.info('4. Procesando orden ID: %s', current_id)
            
            order = self.browse(current_id)
            _logger.info('5. Orden encontrada: %s (amount_total: %s)', order.name, order.amount_total)
            
            try:
                eligible = self._check_products_eligible(order)
                _logger.info('6. Elegibilidad de la orden: %s', eligible)
                
                if order.amount_total >= 1000 and not order.applied_coupon_id and eligible:
                    _logger.info('7. La orden %s califica para cupón', order.name)
                    
                    coupon_amount = order.amount_total * 0.07
                    _logger.info('8. Monto calculado para cupón: %s', coupon_amount)
                    
                    coupon = self.env['pos.coupon'].create({
                        'name': self.env['pos.coupon']._generate_code(),
                        'order_id': order.id,
                        'amount': coupon_amount,
                        'state': 'valid'
                    })
                    _logger.info('9. Cupón creado con código: %s', coupon.name)
                    self._send_whatsapp_coupon(order, coupon, coupon_amount)
                    _logger.info('12. Procesado envío de WhatsApp para orden %s', order.name)

                    
                    order.write({'generated_coupon_id': coupon.id})
                    _logger.info('10. Cupón asociado a la orden')
                    
                    # Añadir datos del cupón al diccionario
                    order_data['generated_coupon_data'] = {
                        'name': coupon.name,
                        'amount': coupon_amount
                    }
                    _logger.info('11. Datos de cupón añadidos al resultado: %s', 
                            order_data['generated_coupon_data'])
                
                self.env.cr.commit()
                _logger.info('12. Transacción confirmada para orden %s', order.name)
                
            except Exception as e:
                _logger.error('ERROR en orden %s: %s', order.name, str(e))
                self.env.cr.rollback()
                continue
            
            result.append(order_data)
            
            _logger.info('13. Orden procesada añadida al resultado: %s', order_data)
             # Enviar mensaje de WhatsApp si hay cupón y número de teléfono
            
                  
        _logger.info('14. Resultado final a retornar: %s', result)
        return result
    
    def _send_whatsapp_coupon(self, order, coupon, coupon_amount):
        """Método privado para enviar cupón por WhatsApp"""
        try:
            partner = order.partner_id
            if not partner or not partner.phone:
                _logger.info('No se puede enviar WhatsApp: Cliente o teléfono no disponible')
                return False

                    # Formatear número de teléfono
            def format_phone(phone_number):
                """Formatea el número de teléfono eliminando espacios y agregando prefijo"""
                if not phone_number:
                    return False
                
                # Eliminar espacios, guiones y paréntesis
                clean_number = ''.join(filter(str.isdigit, phone_number))
                
                # Verificar longitud mínima (10 dígitos sin el 1)
                if len(clean_number) < 10:
                    _logger.error('Número de teléfono inválido (muy corto): %s', phone_number)
                    return False
                
                # Si no empieza con 1, añadirlo
                if not clean_number.startswith('1'):
                    clean_number = '1' + clean_number
                
                _logger.info('Formato de teléfono: Original: %s, Limpio: %s', 
                            phone_number, clean_number)
                
                return clean_number

            # Usar la función format_phone
            phone = format_phone(partner.phone)
            if not phone:
                _logger.error('No se pudo formatear el número de teléfono: %s', partner.phone)
                return False

            _logger.info('Número formateado correctamente: %s', phone)

            expiration_date = (fields.Datetime.now() + timedelta(days=15)).strftime('%Y-%m-%d')
            formatted_amount = int(coupon_amount)
            qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={coupon.name}"
            
            message = f"""¡Felicidades! 🎉,\n```has generado un cupón:``` *{coupon.name}* ,\n ``` con un valor : RD$: ``` *{formatted_amount}*  ```,para tu siguiente compra de accesorios y servicios, válido hasta Valido:, ``` *{expiration_date}.*\n Ver código QR: {qr_url}"""

            return self.env['pos.order'].whatsapp_cupon(phone, message)
            
        except Exception as e:
                _logger.error('Error al enviar WhatsApp: %s', str(e))
                return False
   
    @api.model
    def _order_fields(self, ui_order):
        _logger.info('Procesando campos de orden POS: %s', ui_order)
        fields = super(POSOrder, self)._order_fields(ui_order)
        
        # Manejar cupón aplicado
        if ui_order.get('applied_coupon_id'):
            fields['applied_coupon_id'] = ui_order['applied_coupon_id']
            # Intentar marcar el cupón como usado
            coupon = self.env['pos.coupon'].browse(ui_order['applied_coupon_id'])
            if coupon.exists() and coupon.state == 'valid':
                _logger.info('Marcando cupón %s como usado en orden', coupon.name)
                coupon.write({
                    'state': 'used',
                    'used_in_order': ui_order.get('name', False)
                })
        
        return fields


    def _check_products_eligible(self, order):
        """Verifica si los productos en la orden pertenecen a las categorías elegibles o sus subcategorías"""
        _logger.info('Verificando elegibilidad de productos para orden %s', order.id)
        
        # Lista de categorías elegibles (nombres en minúsculas para comparación)
        eligible_categories = ['servicios', 'accesorios']
        
        def check_category_hierarchy(category):
            """Verifica la jerarquía completa de categorías"""
            if not category:
                return False
                
            # Verificar la categoría actual
            if category.name.lower() in eligible_categories:
                return True
                
            # Verificar categoría padre si existe
            if category.parent_id:
                return check_category_hierarchy(category.parent_id)
                
            return False
        
        for line in order.lines:
            product = line.product_id
            category = product.categ_id
            
            # Obtener la ruta completa de categorías para el logging
            category_path = []
            current_category = category
            while current_category:
                category_path.insert(0, current_category.name)
                current_category = current_category.parent_id
            
            category_string = ' / '.join(category_path) if category_path else 'Sin categoría'
            
            _logger.info('Verificando producto: %s, Ruta de categorías: %s',
                        product.name, category_string)
            
            # Verificar si el producto es elegible
            is_eligible = check_category_hierarchy(category)
            
            if not is_eligible:
                _logger.info('Producto no elegible encontrado: %s (Categorías: %s)',
                            product.name, category_string)
                return False
                
            _logger.info('Producto elegible: %s', product.name)
        
        _logger.info('Todos los productos son elegibles')
        return True

  
