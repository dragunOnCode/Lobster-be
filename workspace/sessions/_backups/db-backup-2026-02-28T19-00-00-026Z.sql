--
-- PostgreSQL database dump
--

\restrict nlW9i9KOFUiYIxQHzCfCzJn7WMxCWalgHAaze0GgtAjlPsF22UzP1AAR9PNy3JK

-- Dumped from database version 16.12 (Debian 16.12-1.pgdg12+1)
-- Dumped by pg_dump version 16.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid,
    user_id uuid,
    agent_id character varying(50),
    agent_name character varying(50),
    role character varying(20) NOT NULL,
    content text NOT NULL,
    mentioned_agents text[] DEFAULT '{}'::text[],
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.messages OWNER TO admin;

--
-- Name: migrations; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    "timestamp" bigint NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.migrations OWNER TO admin;

--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.migrations_id_seq OWNER TO admin;

--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying(200) NOT NULL,
    owner_id uuid,
    participants text[] DEFAULT '{}'::text[],
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_message_at timestamp without time zone
);


ALTER TABLE public.sessions OWNER TO admin;

--
-- Name: users; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(100) NOT NULL,
    password character varying(255) NOT NULL,
    role character varying(20) DEFAULT 'user'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.users OWNER TO admin;

--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public.messages (id, session_id, user_id, agent_id, agent_name, role, content, mentioned_agents, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public.migrations (id, "timestamp", name) FROM stdin;
1	1708272000000	InitialSchema1708272000000
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public.sessions (id, title, owner_id, participants, status, created_at, updated_at, last_message_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public.users (id, username, email, password, role, created_at, updated_at) FROM stdin;
\.


--
-- Name: migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: admin
--

SELECT pg_catalog.setval('public.migrations_id_seq', 1, true);


--
-- Name: migrations PK_8c82d7f526340ab734260ea46be; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_messages_created_at; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_messages_created_at ON public.messages USING btree (created_at);


--
-- Name: idx_messages_session_id; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_messages_session_id ON public.messages USING btree (session_id);


--
-- Name: idx_sessions_owner_id; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_sessions_owner_id ON public.sessions USING btree (owner_id);


--
-- Name: messages messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: messages messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sessions sessions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict nlW9i9KOFUiYIxQHzCfCzJn7WMxCWalgHAaze0GgtAjlPsF22UzP1AAR9PNy3JK

