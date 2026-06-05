-- Employee roster bulk insert — Week of 5/31/26
-- All users assigned Read Only role (role-readonly), first_login = 1, password = username.
-- NOTE: "Devin" (Production – Loading) has no last name on record; username is 'devin'.
--       Update username/display_name once last name is confirmed.
-- NOTE: Carlos Naranjo-Sanchez — hyphen removed from username → cnaranjosanchez.
-- Run: wrangler d1 execute DB --remote --file ./seed-employees.sql

INSERT OR IGNORE INTO users (id, username, display_name, password, role, role_id, is_active, first_login) VALUES
  -- Order Processing
  -- Cutting Lines
  ('user-lsantiago',       'lsantiago',       'Lee Ray Santiago',        'lsantiago',       'readonly', 'role-readonly', 1, 1),
  ('user-eescalante',      'eescalante',      'Eddie Escalante',         'eescalante',      'readonly', 'role-readonly', 1, 1),
  ('user-jwagner',         'jwagner',         'Joseph Wagner',           'jwagner',         'readonly', 'role-readonly', 1, 1),
  ('user-arodriguez',      'arodriguez',      'Ariel Rodriguez',         'arodriguez',      'readonly', 'role-readonly', 1, 1),
  ('user-irudas',          'irudas',          'Israel Rudas',            'irudas',          'readonly', 'role-readonly', 1, 1),
  -- Production Leads
  ('user-acastro',         'acastro',         'Alexis Castro',           'acastro',         'readonly', 'role-readonly', 1, 1),
  ('user-ginsert',         'ginsert',         'Garry Insert',            'ginsert',         'readonly', 'role-readonly', 1, 1),
  -- Hole Cutters
  ('user-rgonzalez',       'rgonzalez',       'Raimond Gonzalez',        'rgonzalez',       'readonly', 'role-readonly', 1, 1),
  ('user-ainsere',         'ainsere',         'Angeleure Insere',        'ainsere',         'readonly', 'role-readonly', 1, 1),
  ('user-jjones',          'jjones',          'Jovan Jones',             'jjones',          'readonly', 'role-readonly', 1, 1),
  ('user-jmontina',        'jmontina',        'Jean Montina',            'jmontina',        'readonly', 'role-readonly', 1, 1),
  ('user-lperez',          'lperez',          'Luiz Perez',              'lperez',          'readonly', 'role-readonly', 1, 1),
  ('user-bluduena',        'bluduena',        'Bryan Luduena',           'bluduena',        'readonly', 'role-readonly', 1, 1),
  -- Production – Loading
  ('user-cnaranjosanchez', 'cnaranjosanchez', 'Carlos Naranjo-Sanchez',  'cnaranjosanchez', 'readonly', 'role-readonly', 1, 1),
  ('user-lsalcedo',        'lsalcedo',        'Luis Salcedo',            'lsalcedo',        'readonly', 'role-readonly', 1, 1),
  ('user-sjean',           'sjean',           'Safran Jean',             'sjean',           'readonly', 'role-readonly', 1, 1),
  ('user-dduvert',         'dduvert',         'Donaldson Duvert',        'dduvert',         'readonly', 'role-readonly', 1, 1),
  ('user-devin',           'devin',           'Devin',                   'devin',           'readonly', 'role-readonly', 1, 1),
  ('user-nvalerio',        'nvalerio',        'Nathan Valerio',          'nvalerio',        'readonly', 'role-readonly', 1, 1),
  -- Production – Grinder
  ('user-jpaul',           'jpaul',           'Jean Paul',               'jpaul',           'readonly', 'role-readonly', 1, 1),
  ('user-gnicanor',        'gnicanor',        'Guy Nicanor',             'gnicanor',        'readonly', 'role-readonly', 1, 1),
  ('user-crivera',         'crivera',         'Carlos Rivera',           'crivera',         'readonly', 'role-readonly', 1, 1),
  ('user-jveliz',          'jveliz',          'Juan Veliz',              'jveliz',          'readonly', 'role-readonly', 1, 1),
  ('user-rvelis',          'rvelis',          'Robert Velis',            'rvelis',          'readonly', 'role-readonly', 1, 1),
  ('user-jgonzalez',       'jgonzalez',       'Jose Gonzalez',           'jgonzalez',       'readonly', 'role-readonly', 1, 1);

-- Populate the junction table for multi-role support
INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES
  ('user-lsantiago',       'role-readonly'),
  ('user-eescalante',      'role-readonly'),
  ('user-jwagner',         'role-readonly'),
  ('user-arodriguez',      'role-readonly'),
  ('user-irudas',          'role-readonly'),
  ('user-acastro',         'role-readonly'),
  ('user-ginsert',         'role-readonly'),
  ('user-rgonzalez',       'role-readonly'),
  ('user-ainsere',         'role-readonly'),
  ('user-jjones',          'role-readonly'),
  ('user-jmontina',        'role-readonly'),
  ('user-lperez',          'role-readonly'),
  ('user-bluduena',        'role-readonly'),
  ('user-cnaranjosanchez', 'role-readonly'),
  ('user-lsalcedo',        'role-readonly'),
  ('user-sjean',           'role-readonly'),
  ('user-dduvert',         'role-readonly'),
  ('user-devin',           'role-readonly'),
  ('user-nvalerio',        'role-readonly'),
  ('user-jpaul',           'role-readonly'),
  ('user-gnicanor',        'role-readonly'),
  ('user-crivera',         'role-readonly'),
  ('user-jveliz',          'role-readonly'),
  ('user-rvelis',          'role-readonly'),
  ('user-jgonzalez',       'role-readonly');
